"use client";

import type { ParamDefinition } from "@/types/node-registry";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Shuffle } from "lucide-react";

interface ParamFieldProps {
  definition: ParamDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
}

export function ParamField({ definition, value, onChange }: ParamFieldProps) {
  switch (definition.type) {
    case "string":
      return (
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">{definition.label}</label>
          <Input value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} className="h-8 text-xs" placeholder={definition.label} />
        </div>
      );
    case "number":
      return (
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">{definition.label}</label>
          <Input type="number" value={(value as number) ?? 0} onChange={(e) => onChange(Number(e.target.value))} className="h-8 text-xs" />
        </div>
      );
    case "slider":
      return (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground">{definition.label}</label>
            <span className="text-xs text-foreground">{value as number}</span>
          </div>
<Slider value={[(value as number) ?? (definition.default as number)]} min={definition.min ?? 0} max={definition.max ?? 100} step={definition.step ?? 1} onValueChange={(val) => onChange(Array.isArray(val) ? val[0] : val)} className="w-full" />
        </div>
      );
    case "select":
      return (
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">{definition.label}</label>
          <Select value={(value as string) ?? definition.default as string} onValueChange={(v) => onChange(v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{(definition.options ?? []).map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}</SelectContent>
          </Select>
        </div>
      );
    case "seed":
      return (
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">{definition.label}</label>
          <div className="flex gap-1">
            <Input type="number" value={(value as number) === -1 ? "" : (value as number)} onChange={(e) => onChange(e.target.value === "" ? -1 : Number(e.target.value))} placeholder="-1 (随机)" className="h-8 flex-1 text-xs" />
            <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => onChange(-1)} title="随机"><Shuffle className="h-3.5 w-3.5" /></Button>
          </div>
        </div>
      );
    case "toggle":
      return (
        <div className="flex items-center justify-between">
          <label className="text-xs text-muted-foreground">{definition.label}</label>
          <Switch checked={(value as boolean) ?? false} onCheckedChange={(v) => onChange(v)} />
        </div>
      );
    default:
      return null;
  }
}
