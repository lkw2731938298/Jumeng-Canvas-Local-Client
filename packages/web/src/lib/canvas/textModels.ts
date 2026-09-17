/** Shared text model ids — 开源副本无预置；API keys 在 config/llm-keys.env。 */

export const TEXT_MODEL_OPTIONS: { value: string; label: string; provider: string }[] = [];

export type TextModelId = string;

export const DEFAULT_TEXT_MODEL: TextModelId = "";
