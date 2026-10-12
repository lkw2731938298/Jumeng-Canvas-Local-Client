"use client";

/**
 * 用户设置页：外壳 + 与弹窗共用的 UserSettingsContent
 */

import { HuabuPublicShell } from "@/components/huabu/HuabuPublicShell";
import { UserSettingsContent } from "@/components/settings/UserSettingsContent";

export default function LocalSettingsPage() {
  return (
    <HuabuPublicShell sidebar page="settings">
      <UserSettingsContent variant="page" />
    </HuabuPublicShell>
  );
}
