import ListView from "@/components/ListView";

export default async function ListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ListView listId={id} />;
}
