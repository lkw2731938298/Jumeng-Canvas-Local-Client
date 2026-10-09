"use client";

/** 顶栏上方的聚梦条：返回画布 */

import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export function JumengChrome() {
	return (
		<div className="flex h-10 shrink-0 items-center justify-between border-b border-white/10 bg-black/40 px-3">
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className="gap-1.5 text-white/80 hover:text-white"
				onClick={() => {
					const bridge = (
						window as Window & {
							__jumengBridge?: { returnToCanvas: () => void };
						}
					).__jumengBridge;
					if (bridge) {
						bridge.returnToCanvas();
						return;
					}
					if (window.opener) {
						window.close();
					} else {
						window.history.back();
					}
				}}
			>
				<ArrowLeft className="size-4" />
				返回画布
			</Button>
			<span className="text-[11px] text-white/40">聚梦本地剪辑台</span>
		</div>
	);
}
