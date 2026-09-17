"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (title: string) => void;
  isLoading: boolean;
}

export function CreateProjectDialog({ open, onOpenChange, onCreate, isLoading }: Props) {
  const [title, setTitle] = useState("");

  const handleCreate = () => {
    const t = title.trim();
    if (t) { onCreate(t); setTitle(""); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setTitle(""); onOpenChange(v); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>新建项目</DialogTitle></DialogHeader>
        <Input placeholder="输入项目名称" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleCreate} disabled={!title.trim() || isLoading}>
            {isLoading ? "创建中..." : "创建"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
