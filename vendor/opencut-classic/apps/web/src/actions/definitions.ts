import type { ShortcutKey } from "@/actions/keybinding";
import type { TActionWithOptionalArgs } from "./types";

export type TActionCategory =
	| "playback"
	| "navigation"
	| "editing"
	| "selection"
	| "history"
	| "timeline"
	| "controls"
	| "assets";

export interface TActionBaseDefinition {
	description: string;
	category: TActionCategory;
	args?: Record<string, unknown>;
}

export interface TActionDefinition extends TActionBaseDefinition {
	defaultShortcuts?: readonly ShortcutKey[];
}

export const ACTIONS = {
	"toggle-play": {
		description: "播放/暂停",
		category: "playback",
	},
	"stop-playback": {
		description: "停止播放",
		category: "playback",
	},
	"seek-forward": {
		description: "前进 1 秒",
		category: "playback",
		args: { seconds: "number" },
	},
	"seek-backward": {
		description: "后退 1 秒",
		category: "playback",
		args: { seconds: "number" },
	},
	"frame-step-forward": {
		description: "下一帧",
		category: "navigation",
	},
	"frame-step-backward": {
		description: "上一帧",
		category: "navigation",
	},
	"jump-forward": {
		description: "前进 5 秒",
		category: "navigation",
		args: { seconds: "number" },
	},
	"jump-backward": {
		description: "后退 5 秒",
		category: "navigation",
		args: { seconds: "number" },
	},
	"goto-start": {
		description: "跳到时间线开头",
		category: "navigation",
	},
	"goto-end": {
		description: "跳到时间线结尾",
		category: "navigation",
	},
	split: {
		description: "在播放头处分割",
		category: "editing",
	},
	"split-left": {
		description: "分割并删除左侧",
		category: "editing",
	},
	"split-right": {
		description: "分割并删除右侧",
		category: "editing",
	},
	"delete-selected": {
		description: "删除当前选中",
		category: "editing",
	},
	"copy-selected": {
		description: "复制选中元素",
		category: "editing",
	},
	"paste-copied": {
		description: "在播放头处粘贴",
		category: "editing",
	},
	"toggle-snapping": {
		description: "切换吸附",
		category: "editing",
	},
	"toggle-ripple-editing": {
		description: "切换波纹编辑",
		category: "editing",
	},
	"toggle-source-audio": {
		description: "分离或恢复源音频",
		category: "editing",
	},
	"select-all": {
		description: "全选元素",
		category: "selection",
	},
	"cancel-interaction": {
		description: "取消当前操作",
		category: "controls",
	},
	"deselect-all": {
		description: "取消全选",
		category: "selection",
	},
	"duplicate-selected": {
		description: "复制选中元素",
		category: "selection",
	},
	"toggle-elements-muted-selected": {
		description: "静音/取消静音选中元素",
		category: "selection",
	},
	"toggle-elements-visibility-selected": {
		description: "显示/隐藏选中元素",
		category: "selection",
	},
	"toggle-bookmark": {
		description: "在播放头处切换书签",
		category: "timeline",
	},
	undo: {
		description: "撤销",
		category: "history",
	},
	redo: {
		description: "重做",
		category: "history",
	},
	"remove-media-asset": {
		description: "移除素材",
		category: "assets",
		args: { projectId: "string", assetId: "string" },
	},
	"remove-media-assets": {
		description: "移除多个素材",
		category: "assets",
		args: { projectId: "string", assetIds: "string[]" },
	},
} as const satisfies Record<string, TActionBaseDefinition>;

export type TAction = keyof typeof ACTIONS;

const ACTION_DEFAULT_SHORTCUTS = [
	["toggle-play", ["space", "k"]],
	["seek-forward", ["l"]],
	["seek-backward", ["j"]],
	["frame-step-forward", ["right"]],
	["frame-step-backward", ["left"]],
	["jump-forward", ["shift+right"]],
	["jump-backward", ["shift+left"]],
	["goto-start", ["home", "enter"]],
	["goto-end", ["end"]],
	["split", ["s"]],
	["split-left", ["q"]],
	["split-right", ["w"]],
	["delete-selected", ["backspace", "delete"]],
	["copy-selected", ["ctrl+c"]],
	["paste-copied", ["ctrl+v"]],
	["toggle-snapping", ["n"]],
	["select-all", ["ctrl+a"]],
	["cancel-interaction", ["escape"]],
	["duplicate-selected", ["ctrl+d"]],
	["undo", ["ctrl+z"]],
	["redo", ["ctrl+shift+z", "ctrl+y"]],
] as const satisfies ReadonlyArray<
	readonly [TActionWithOptionalArgs, readonly ShortcutKey[]]
>;

const ACTION_DEFAULT_SHORTCUTS_BY_ACTION = new Map<
	TAction,
	readonly ShortcutKey[]
>(ACTION_DEFAULT_SHORTCUTS);

export function getActionDefinition({
	action,
}: {
	action: TAction;
}): TActionDefinition {
	return {
		...ACTIONS[action],
		defaultShortcuts: ACTION_DEFAULT_SHORTCUTS_BY_ACTION.get(action),
	};
}

export function getDefaultShortcuts(): Map<
	ShortcutKey,
	TActionWithOptionalArgs
> {
	const shortcuts = new Map<ShortcutKey, TActionWithOptionalArgs>();

	for (const [action, defaultShortcuts] of ACTION_DEFAULT_SHORTCUTS) {
		for (const shortcut of defaultShortcuts) {
			shortcuts.set(shortcut, action);
		}
	}

	return shortcuts;
}
