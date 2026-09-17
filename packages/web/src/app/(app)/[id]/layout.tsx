import type { Metadata } from "next";
import { ApplyProjectSeo } from "@/components/canvas/ApplyProjectSeo";
import { projectCanvasSeo, projectSeoNumber } from "@/lib/pageSeo";

/** 项目画布页：title=`编号-开源画布`，keywords/description=编号 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return projectCanvasSeo(projectSeoNumber(undefined, id));
}

export default function ProjectCanvasLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ApplyProjectSeo />
      {children}
    </>
  );
}
