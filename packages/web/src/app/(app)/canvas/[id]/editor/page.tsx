import { redirect } from "next/navigation";

/** Legacy URL: /canvas/canvas/{projectId}/editor → /canvas/{projectId}/editor */
export default async function LegacyVideoEditorRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/${id}/editor`);
}
