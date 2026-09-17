import { NextResponse } from "next/server";

/** 已废弃：见 /api/workflow-presets 说明。 */
export async function DELETE() {
  return NextResponse.json(
    {
      code: "4101",
      message: "预设工作流已迁移为组库，请使用 /api/v1/node-groups",
      content: { migratedTo: "/api/v1/node-groups" },
    },
    { status: 410 }
  );
}
