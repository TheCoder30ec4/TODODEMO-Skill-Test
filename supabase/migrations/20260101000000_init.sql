-- Implements contracts/data-model.md and contracts/rls.md. Idempotent.
-- FORCE ROW LEVEL SECURITY must stay off (DEFINER helpers owned by postgres rely on owner bypass).

create table if not exists public.lists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  created_at timestamptz not null default now()
);
create index if not exists lists_owner_id_idx on public.lists (owner_id);

create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 500),
  done boolean not null default false,
  position integer not null default 0 check (position >= 0),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists todos_list_id_position_idx on public.todos (list_id, position);

create table if not exists public.list_members (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists(id) on delete cascade,
  email text not null
    check (email = lower(btrim(email)))
    check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role text not null check (role in ('viewer','editor')),
  added_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint list_members_list_id_email_key unique (list_id, email)
);
create index if not exists list_members_email_idx on public.list_members (email);

alter table public.lists enable row level security;
alter table public.todos enable row level security;
alter table public.list_members enable row level security;

-- ---------- functions ----------
create or replace function public.list_role(p_list_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.lists l where l.id = p_list_id and l.owner_id = auth.uid())
      then 'owner'
    else (
      select m.role from public.list_members m
      where m.list_id = p_list_id
        and m.email = (select lower(u.email) from auth.users u
                       where u.id = auth.uid() and u.email_confirmed_at is not null)
    )
  end
$$;

create or replace function public.my_role(l public.lists) returns text
language sql stable security invoker set search_path = '' as $$
  select public.list_role(l.id)
$$;

create or replace function public.my_member_id(l public.lists) returns uuid
language sql stable security definer set search_path = '' as $$
  select m.id from public.list_members m
  where m.list_id = l.id
    and m.email = (select lower(u.email) from auth.users u
                   where u.id = auth.uid() and u.email_confirmed_at is not null)
$$;

create or replace function public.reorder_todos(p_list_id uuid, p_ids uuid[]) returns void
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_role text := public.list_role(p_list_id);
  v_n int;
begin
  if v_role is null then raise exception 'not_found' using errcode = 'P0001'; end if;
  if v_role = 'viewer' then raise exception 'forbidden' using errcode = 'P0001'; end if;
  p_ids := coalesce(p_ids, '{}');
  select count(*) into v_n from public.todos where list_id = p_list_id;
  -- exact set: same cardinality, no duplicates, every id belongs to the list
  if cardinality(p_ids) <> v_n
     or (select count(distinct x) from unnest(p_ids) x) <> v_n
     or exists (select 1 from unnest(p_ids) x
                where not exists (select 1 from public.todos t where t.id = x and t.list_id = p_list_id))
  then raise exception 'conflict' using errcode = 'P0001'; end if;
  update public.todos t set position = o.ord - 1
  from unnest(p_ids) with ordinality as o(id, ord)
  where t.id = o.id and t.list_id = p_list_id;
end
$$;

create or replace function public.todos_set_updated_at() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin new.updated_at := now(); return new; end
$$;

drop trigger if exists todos_set_updated_at on public.todos;
create trigger todos_set_updated_at before update on public.todos
  for each row execute function public.todos_set_updated_at();

alter function public.list_role(uuid) owner to postgres;
alter function public.my_role(public.lists) owner to postgres;
alter function public.my_member_id(public.lists) owner to postgres;
alter function public.reorder_todos(uuid, uuid[]) owner to postgres;
alter function public.todos_set_updated_at() owner to postgres;

-- ---------- privileges ----------
revoke all on table public.lists, public.todos, public.list_members from public, anon, authenticated;
grant select, insert, delete on public.lists, public.todos, public.list_members to authenticated;
grant update (title) on public.lists to authenticated;
grant update (title, done, position) on public.todos to authenticated;
grant update (role) on public.list_members to authenticated;

revoke all on function public.list_role(uuid) from public, anon, authenticated;
revoke all on function public.my_role(public.lists) from public, anon, authenticated;
revoke all on function public.my_member_id(public.lists) from public, anon, authenticated;
revoke all on function public.reorder_todos(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.todos_set_updated_at() from public, anon, authenticated;
grant execute on function public.list_role(uuid) to authenticated;
grant execute on function public.my_role(public.lists) to authenticated;
grant execute on function public.my_member_id(public.lists) to authenticated;
grant execute on function public.reorder_todos(uuid, uuid[]) to authenticated;

-- ---------- policies (all TO authenticated) ----------
drop policy if exists lists_select on public.lists;
create policy lists_select on public.lists for select to authenticated
  using (owner_id = auth.uid() or public.list_role(id) is not null);
drop policy if exists lists_insert on public.lists;
create policy lists_insert on public.lists for insert to authenticated
  with check (owner_id = auth.uid());
drop policy if exists lists_update on public.lists;
create policy lists_update on public.lists for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists lists_delete on public.lists;
create policy lists_delete on public.lists for delete to authenticated
  using (owner_id = auth.uid());

drop policy if exists todos_select on public.todos;
create policy todos_select on public.todos for select to authenticated
  using (public.list_role(list_id) is not null);
drop policy if exists todos_insert on public.todos;
create policy todos_insert on public.todos for insert to authenticated
  with check (public.list_role(list_id) in ('owner','editor') and created_by = auth.uid());
drop policy if exists todos_update on public.todos;
create policy todos_update on public.todos for update to authenticated
  using (public.list_role(list_id) in ('owner','editor'))
  with check (public.list_role(list_id) in ('owner','editor'));
drop policy if exists todos_delete on public.todos;
create policy todos_delete on public.todos for delete to authenticated
  using (public.list_role(list_id) in ('owner','editor'));

drop policy if exists list_members_select on public.list_members;
create policy list_members_select on public.list_members for select to authenticated
  using (public.list_role(list_id) is not null);
drop policy if exists list_members_insert on public.list_members;
create policy list_members_insert on public.list_members for insert to authenticated
  with check (public.list_role(list_id) = 'owner' and added_by = auth.uid());
drop policy if exists list_members_update on public.list_members;
create policy list_members_update on public.list_members for update to authenticated
  using (public.list_role(list_id) = 'owner') with check (public.list_role(list_id) = 'owner');
drop policy if exists list_members_delete on public.list_members;
create policy list_members_delete on public.list_members for delete to authenticated
  using (public.list_role(list_id) = 'owner');

-- ---------- realtime ----------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['lists','todos','list_members'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
