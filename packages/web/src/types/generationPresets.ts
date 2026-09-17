export interface GenerationPresetItem {
  id: string;
  label: string;
  enabled?: boolean;
  sortOrder?: number;
  promptSuffix?: string;
  api?: Record<string, unknown>;
}

export interface GenerationPresetGroup {
  id: string;
  label: string;
  defaultId?: string;
  /** 为 true 时前端不展示该选项组（如自动计费开关） */
  uiHidden?: boolean;
  items: GenerationPresetItem[];
}

export interface GenerationPresetsConfig {
  version?: number;
  groups: GenerationPresetGroup[];
  composeRules?: {
    promptJoiner?: string;
    apiMergePriority?: string[];
  };
}

export type GenerationOptions = Record<string, string>;
