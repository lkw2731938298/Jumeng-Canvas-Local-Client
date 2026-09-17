import { redirect } from "next/navigation";

/** Legacy URL: /canvas/canvas/{projectId}/director/{nodeId} */
export default async function LegacyDirectorStageRedirect({
  params,
}: {
  params: Promise<{ id: string; nodeId: string }>;
}) {
  const { id, nodeId } = await params;
  redirect(`/${id}/director/${nodeId}`);
}
