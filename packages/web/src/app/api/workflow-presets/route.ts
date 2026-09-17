import { NextResponse } from "next/server";

/**
 * 已废弃：预设工作流改为「组库」`/api/v1/node-groups`。
 * 保留路由避免旧前端硬 404，引导迁移。
 */
export async function GET() {
  return NextResponse.json(
    {
      code: "4101",
      message: "预设工作流已迁移为组库，请使用 /api/v1/node-groups",
      content: { migratedTo: "/api/v1/node-groups" },
    },
    { status: 410 }
  );
}

export async function POST() {
  return GET();
}
