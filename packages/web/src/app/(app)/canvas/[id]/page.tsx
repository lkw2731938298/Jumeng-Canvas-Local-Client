import { redirect } from "next/navigation";

/** Legacy URL: /canvas/canvas/{projectId} → /canvas/{projectId} */
export default async function LegacyCanvasProjectRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/${id}`);
}
