import { redirect } from "next/navigation";

/** 开源本地版：根路径进入项目列表（不再展示商业发现页） */
export default function HomePage() {
  redirect("/projects");
}
