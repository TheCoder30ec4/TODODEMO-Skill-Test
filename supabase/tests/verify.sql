-- RLS/role-matrix verification. Run in the Supabase SQL editor or psql as postgres.
-- Creates throwaway users and data inside one transaction and ROLLS BACK at the end.
-- Any failed check raises an exception; success prints a NOTICE.
begin;

create function pg_temp.as_user(p_uid uuid, p_jwt_email text default null) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'email', p_jwt_email)::text, true);
  execute 'set local role authenticated';
end $$;

-- count rows visible/affected for a query, as the current role
create function pg_temp.cnt(q text) returns bigint language plpgsql as $$
declare n bigint; begin execute 'select count(*) from (' || q || ') s' into n; return n; end $$;
-- rows affected by a DML statement
create function pg_temp.aff(q text) returns bigint language plpgsql as $$
declare n bigint; begin execute q; get diagnostics n = row_count; return n; end $$;
-- sqlstate raised by a statement, or null
create function pg_temp.err(q text) returns text language plpgsql as $$
begin execute q; return null; exception when others then return sqlstate; end $$;
create function pg_temp.chk(p_name text, p_ok boolean) returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'VERIFY FAILED: %', p_name; end if; end $$;

do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); v uuid := gen_random_uuid();
  c uuid := gen_random_uuid(); u uuid := gen_random_uuid();
  l uuid; l2 uuid; sp uuid; t uuid; mb uuid; mv uuid; mu uuid; r text; n bigint;
  tbl text;
begin
  -- fixtures (as postgres)
  insert into auth.users (id, email, email_confirmed_at) values
    (a, 'a@x.test', now()), (b, 'b@x.test', now()), (v, 'v@x.test', now()),
    (c, 'c@x.test', now()), (u, 'u@x.test', null);

  perform pg_temp.as_user(a);
  insert into public.lists (title) values ('L') returning id into l;   -- insert..returning works for owner
  insert into public.todos (list_id, title, created_by) values (l, 'T', a) returning id into t;
  insert into public.list_members (list_id, email, role, added_by) values (l, 'b@x.test', 'editor', a) returning id into mb;
  insert into public.list_members (list_id, email, role, added_by) values (l, 'v@x.test', 'viewer', a) returning id into mv;
  insert into public.list_members (list_id, email, role, added_by) values (l, 'u@x.test', 'editor', a) returning id into mu;
  reset role;

  -- owner who also has own member row: my_member_id must stay NULL, role stays owner
  insert into public.list_members (list_id, email, role, added_by) values (l, 'a@x.test', 'viewer', a);
  perform pg_temp.as_user(a);
  perform pg_temp.chk('owner with member row: role owner', public.list_role(l) = 'owner');
  perform pg_temp.chk('owner with member row: my_member_id null', (select x.my_member_id from public.lists x where x.id = l) is null);
  reset role;
  delete from public.list_members where list_id = l and email = 'a@x.test';

  -- spoofed server-owned timestamps on INSERT are overridden
  perform pg_temp.as_user(b);
  insert into public.todos (list_id, title, created_by, created_at, updated_at) values (l, 'spoof', b, '1999-01-01', '2099-01-01') returning id into sp;
  perform pg_temp.chk('todo insert created_at forced', (select created_at from public.todos where id = sp) > now() - interval '1 day');
  perform pg_temp.chk('todo insert updated_at forced', (select updated_at from public.todos where id = sp) < now() + interval '1 day');
  reset role;
  perform pg_temp.as_user(a);
  insert into public.lists (title, created_at) values ('spoof', '1999-01-01') returning id into l2;
  perform pg_temp.chk('list insert created_at forced', (select created_at from public.lists where id = l2) > now() - interval '1 day');
  insert into public.list_members (list_id, email, role, added_by, created_at) values (l2, 'q@x.test', 'viewer', a, '1999-01-01') returning id into sp;
  perform pg_temp.chk('member insert created_at forced', (select created_at from public.list_members where id = sp) > now() - interval '1 day');
  reset role;
  delete from public.lists where id = l2;

  -- list_role matrix
  perform pg_temp.as_user(a); perform pg_temp.chk('role owner',  public.list_role(l) = 'owner'); reset role;
  perform pg_temp.as_user(b); perform pg_temp.chk('role editor', public.list_role(l) = 'editor'); reset role;
  perform pg_temp.as_user(v); perform pg_temp.chk('role viewer', public.list_role(l) = 'viewer'); reset role;
  perform pg_temp.as_user(c); perform pg_temp.chk('role nonmember null', public.list_role(l) is null); reset role;
  perform pg_temp.as_user(u); perform pg_temp.chk('role unconfirmed null', public.list_role(l) is null); reset role;
  -- forged JWT email claim grants nothing
  perform pg_temp.as_user(c, 'b@x.test'); perform pg_temp.chk('forged jwt email null', public.list_role(l) is null); reset role;
  -- owner wins over a member row for own email
  -- (owner a has no member row; check my_role/my_member_id computed fields)
  perform pg_temp.as_user(a);
  perform pg_temp.chk('my_role owner', (select x.my_role from public.lists x where x.id = l) = 'owner');
  perform pg_temp.chk('my_member_id owner null', (select x.my_member_id from public.lists x where x.id = l) is null);
  reset role;
  perform pg_temp.as_user(b);
  perform pg_temp.chk('my_role editor', (select x.my_role from public.lists x where x.id = l) = 'editor');
  perform pg_temp.chk('my_member_id editor', (select x.my_member_id from public.lists x where x.id = l) = mb);
  reset role;

  -- SELECT per table: owner/editor/viewer see; non-member and unconfirmed see nothing
  foreach tbl in array array['lists','todos','list_members'] loop
    perform pg_temp.as_user(a); perform pg_temp.chk('select owner '||tbl, pg_temp.cnt('select 1 from public.'||tbl) > 0); reset role;
    perform pg_temp.as_user(b); perform pg_temp.chk('select editor '||tbl, pg_temp.cnt('select 1 from public.'||tbl) > 0); reset role;
    perform pg_temp.as_user(v); perform pg_temp.chk('select viewer '||tbl, pg_temp.cnt('select 1 from public.'||tbl) > 0); reset role;
    perform pg_temp.as_user(c); perform pg_temp.chk('select nonmember '||tbl, pg_temp.cnt('select 1 from public.'||tbl) = 0); reset role;
    perform pg_temp.as_user(u); perform pg_temp.chk('select unconfirmed '||tbl, pg_temp.cnt('select 1 from public.'||tbl) = 0); reset role;
    perform pg_temp.as_user(c, 'b@x.test'); perform pg_temp.chk('select forged '||tbl, pg_temp.cnt('select 1 from public.'||tbl) = 0); reset role;
  end loop;
  -- anon: no privileges
  execute 'set local role anon';
  perform pg_temp.chk('anon select lists denied', pg_temp.err('select 1 from public.lists') = '42501');
  perform pg_temp.chk('anon select todos denied', pg_temp.err('select 1 from public.todos') = '42501');
  perform pg_temp.chk('anon select members denied', pg_temp.err('select 1 from public.list_members') = '42501');
  perform pg_temp.chk('anon list_role denied', pg_temp.err(format('select public.list_role(%L)', l)) = '42501');
  reset role;

  -- todos writes
  perform pg_temp.as_user(b);   -- editor
  perform pg_temp.chk('editor insert todo', pg_temp.err(format('insert into public.todos(list_id,title,created_by) values (%L,%L,%L)', l, 'e', b)) is null);
  perform pg_temp.chk('editor insert todo spoof created_by', pg_temp.err(format('insert into public.todos(list_id,title,created_by) values (%L,%L,%L)', l, 'e', a)) = '42501');
  perform pg_temp.chk('editor update todo', pg_temp.aff(format('update public.todos set done = true where id = %L', t)) = 1);
  perform pg_temp.chk('editor cannot move todo (list_id col)', pg_temp.err(format('update public.todos set list_id = %L where id = %L', l, t)) = '42501');
  perform pg_temp.chk('editor cannot set updated_at', pg_temp.err(format('update public.todos set updated_at = now() where id = %L', t)) = '42501');
  reset role;
  perform pg_temp.as_user(v);   -- viewer
  perform pg_temp.chk('viewer insert todo denied', pg_temp.err(format('insert into public.todos(list_id,title,created_by) values (%L,%L,%L)', l, 'x', v)) = '42501');
  perform pg_temp.chk('viewer update todo 0 rows', pg_temp.aff(format('update public.todos set done = false where id = %L', t)) = 0);
  perform pg_temp.chk('viewer delete todo 0 rows', pg_temp.aff(format('delete from public.todos where id = %L', t)) = 0);
  reset role;
  foreach r in array array['c','u'] loop   -- non-member, unconfirmed
    perform pg_temp.as_user(case r when 'c' then c else u end);
    perform pg_temp.chk('nonmember insert todo '||r, pg_temp.err(format('insert into public.todos(list_id,title,created_by) values (%L,%L,auth.uid())', l, 'x')) = '42501');
    perform pg_temp.chk('nonmember update todo '||r, pg_temp.aff(format('update public.todos set done = false where id = %L', t)) = 0);
    perform pg_temp.chk('nonmember delete todo '||r, pg_temp.aff(format('delete from public.todos where id = %L', t)) = 0);
    perform pg_temp.chk('nonmember insert member '||r, pg_temp.err(format('insert into public.list_members(list_id,email,role,added_by) values (%L,%L,%L,auth.uid())', l, 'c@x.test', 'editor')) = '42501');
    perform pg_temp.chk('nonmember update member '||r, pg_temp.aff(format('update public.list_members set role = %L where id = %L', 'viewer', mb)) = 0);
    perform pg_temp.chk('nonmember delete member '||r, pg_temp.aff(format('delete from public.list_members where id = %L', mb)) = 0);
    perform pg_temp.chk('nonmember update list '||r, pg_temp.aff(format('update public.lists set title = %L where id = %L', 'h', l)) = 0);
    perform pg_temp.chk('nonmember delete list '||r, pg_temp.aff(format('delete from public.lists where id = %L', l)) = 0);
    reset role;
  end loop;

  -- list_members writes: editor/viewer cannot escalate
  perform pg_temp.as_user(b);
  perform pg_temp.chk('editor insert member denied', pg_temp.err(format('insert into public.list_members(list_id,email,role,added_by) values (%L,%L,%L,%L)', l, 'c@x.test', 'editor', b)) = '42501');
  perform pg_temp.chk('editor self-escalate 0 rows', pg_temp.aff(format('update public.list_members set role = %L where id = %L', 'editor', mb)) = 0);
  perform pg_temp.chk('editor delete member 0 rows', pg_temp.aff(format('delete from public.list_members where id = %L', mv)) = 0);
  perform pg_temp.chk('editor update list 0 rows', pg_temp.aff(format('update public.lists set title = %L where id = %L', 'h', l)) = 0);
  perform pg_temp.chk('editor delete list 0 rows', pg_temp.aff(format('delete from public.lists where id = %L', l)) = 0);
  reset role;
  perform pg_temp.as_user(v);
  perform pg_temp.chk('viewer self-escalate 0 rows', pg_temp.aff(format('update public.list_members set role = %L where id = %L', 'editor', mv)) = 0);
  perform pg_temp.chk('viewer insert self as member denied', pg_temp.err(format('insert into public.list_members(list_id,email,role,added_by) values (%L,%L,%L,%L)', l, 'v2@x.test', 'editor', v)) = '42501');
  reset role;

  -- owner: member writes; only role updatable
  perform pg_temp.as_user(a);
  perform pg_temp.chk('owner update member role', pg_temp.aff(format('update public.list_members set role = %L where id = %L', 'viewer', mv)) = 1);
  perform pg_temp.chk('owner cannot update member email', pg_temp.err(format('update public.list_members set email = %L where id = %L', 'z@x.test', mv)) = '42501');
  perform pg_temp.chk('owner cannot update member list_id', pg_temp.err(format('update public.list_members set list_id = %L where id = %L', l, mv)) = '42501');
  perform pg_temp.chk('owner cannot transfer list', pg_temp.err(format('update public.lists set owner_id = %L where id = %L', b, l)) = '42501');
  perform pg_temp.chk('owner rename list', pg_temp.aff(format('update public.lists set title = %L where id = %L', 'L2', l)) = 1);
  perform pg_temp.chk('owner insert list for other user denied', pg_temp.err(format('insert into public.lists(owner_id,title) values (%L,%L)', b, 'x')) = '42501');
  perform pg_temp.chk('owner member email must be lowercase', pg_temp.err(format('insert into public.list_members(list_id,email,role,added_by) values (%L,%L,%L,%L)', l, 'Q@x.test', 'editor', a)) = '23514');
  perform pg_temp.chk('owner duplicate member conflict', pg_temp.err(format('insert into public.list_members(list_id,email,role,added_by) values (%L,%L,%L,%L)', l, 'b@x.test', 'editor', a)) = '23505');
  reset role;
  -- role downgrade takes effect: v now viewer (unchanged); b -> viewer blocks todo writes
  perform pg_temp.as_user(a); perform pg_temp.aff(format('update public.list_members set role = %L where id = %L', 'viewer', mb)); reset role;
  perform pg_temp.as_user(b);
  perform pg_temp.chk('downgraded editor blocked', pg_temp.aff(format('update public.todos set done = false where id = %L', t)) = 0);
  reset role;
  perform pg_temp.as_user(a); perform pg_temp.aff(format('update public.list_members set role = %L where id = %L', 'editor', mb)); reset role;

  -- updated_at trigger: backdate as postgres (trigger disabled), then a client update must bump it
  alter table public.todos disable trigger todos_set_updated_at;
  update public.todos set updated_at = '2000-01-01', created_at = '2000-01-01' where id = t;
  alter table public.todos enable trigger todos_set_updated_at;
  perform pg_temp.as_user(b);
  update public.todos set title = 'renamed' where id = t;
  perform pg_temp.chk('updated_at bumped by trigger', (select updated_at from public.todos where id = t) > now() - interval '1 day');
  perform pg_temp.chk('created_at unchanged on update', (select created_at from public.todos where id = t) = '2000-01-01');
  reset role;

  -- reorder_todos
  perform pg_temp.as_user(a);
  insert into public.todos (list_id, title, created_by, position) values (l, 'T3', a, 5);
  reset role;
  perform pg_temp.as_user(b);
  perform pg_temp.chk('reorder conflict missing', pg_temp.err(format('select public.reorder_todos(%L, array[%L]::uuid[])', l, t)) = 'P0001');
  reset role;
  declare ids uuid[]; rev uuid[]; begin
    ids := array(select id from public.todos where list_id = l order by created_at, id);
    rev := array(select x from unnest(ids) with ordinality o(x, i) order by i desc);
    perform pg_temp.as_user(b);
    perform public.reorder_todos(l, rev);
    perform pg_temp.chk('reorder positions 0-based', (select array_agg(id order by position) from public.todos where list_id = l) = rev
      and (select min(position) from public.todos where list_id = l) = 0);
    perform pg_temp.chk('reorder duplicate conflict', pg_temp.err(format('select public.reorder_todos(%L, %L::uuid[])', l, array[rev[1], rev[1], rev[1]])) = 'P0001');
    reset role;
    perform pg_temp.as_user(v);
    begin perform public.reorder_todos(l, rev); raise exception 'viewer reorder succeeded';
    exception when sqlstate 'P0001' then perform pg_temp.chk('reorder viewer forbidden', sqlerrm = 'forbidden'); end;
    reset role;
    perform pg_temp.as_user(c);
    begin perform public.reorder_todos(l, rev); raise exception 'nonmember reorder succeeded';
    exception when sqlstate 'P0001' then perform pg_temp.chk('reorder nonmember not_found', sqlerrm = 'not_found'); end;
    reset role;
  end;

  -- structural checks
  perform pg_temp.chk('RLS enabled on lists, todos, list_members',
    (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
       and c.relname in ('lists','todos','list_members') and c.relrowsecurity) = 3);
  perform pg_temp.chk('no public table without RLS',
    not exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity));
  perform pg_temp.chk('realtime publication has the 3 tables',
    (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
       and tablename in ('lists','todos','list_members')) = 3);
  perform pg_temp.chk('FORCE RLS off',
    not exists (select 1 from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relforcerowsecurity));
  perform pg_temp.chk('all policies TO authenticated only',
    not exists (select 1 from pg_policies where schemaname = 'public' and roles <> '{authenticated}'));
  perform pg_temp.chk('functions have empty search_path',
    not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
      and (p.proconfig is null or not ('search_path=""' = any (p.proconfig)))));
  perform pg_temp.chk('anon has no table grants',
    not exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon'));

  -- cascade
  delete from public.lists where id = l;  -- as postgres
  perform pg_temp.chk('cascade todos', not exists (select 1 from public.todos where list_id = l));
  perform pg_temp.chk('cascade members', not exists (select 1 from public.list_members where list_id = l));

  raise notice 'verify.sql: ALL CHECKS PASSED';
end $$;

rollback;
