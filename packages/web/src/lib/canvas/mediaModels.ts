/**
 * Media generation model fallbacks when API catalog is unavailable.
 * 开源副本：无预置型号；以 GET /api/v1/models 为准。
 */

export const IMAGE_MODEL_OPTIONS: { value: string; label: string }[] = [];

export const VIDEO_MODEL_OPTIONS: { value: string; label: string }[] = [];

export const AUDIO_MODEL_OPTIONS: { value: string; label: string }[] = [];

export const DEFAULT_IMAGE_MODEL = "";
export const DEFAULT_VIDEO_MODEL = "";
export const DEFAULT_AUDIO_MODEL = "";
