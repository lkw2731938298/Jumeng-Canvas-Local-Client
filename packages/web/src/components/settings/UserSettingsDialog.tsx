"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UserSettingsContent } from "@/components/settings/UserSettingsContent";

type UserSettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** 画布内「用户设置」弹窗：与设置页同一套内容 */
export function UserSettingsDialog({ open, onOpenChange }: UserSettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="flex max-h-[min(920px,92vh)] w-[min(1280px,calc(100vw-32px))] max-w-[min(1280px,calc(100vw-32px))] flex-col gap-0 overflow-hidden border-border bg-background p-0 sm:max-w-[min(1280px,calc(100vw-32px))]"
        overlayClassName="bg-black/50 supports-backdrop-filter:backdrop-blur-sm"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>画布设置</DialogTitle>
          <DialogDescription>外观、模型服务与存储空间</DialogDescription>
        </DialogHeader>
        {open ? <UserSettingsContent variant="dialog" /> : null}
      </DialogContent>
    </Dialog>
  );
}
