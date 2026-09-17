import type { Metadata } from "next";
import { PROJECTS_SEO } from "@/lib/pageSeo";

/** 项目页 SEO（title / keywords / description） */
export const metadata: Metadata = PROJECTS_SEO;

export default function ProjectsSeoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
