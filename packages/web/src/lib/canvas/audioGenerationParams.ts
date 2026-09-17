/** 音频生成参数（底栏「生成参数」面板，对齐产品截图） */

export const AUDIO_SOUND_EFFECTS = [
  { id: "none", label: "无" },
  { id: "echo", label: "空旷回音" },
  { id: "hall", label: "礼堂广播" },
  { id: "phone", label: "电话失真" },
  { id: "electronic", label: "电音" },
] as const;

export type AudioSoundEffectId = (typeof AUDIO_SOUND_EFFECTS)[number]["id"];

export interface AudioGenerationParams {
  /** 语速 */
  speechRate: number;
  /** 声调 */
  tone: number;
  /** 音量 */
  volume: number;
  /** 音高 */
  pitch: number;
  /** 强度 */
  intensity: number;
  /** 音色调节 */
  timbre: number;
  /** 音效预设 */
  soundEffect: AudioSoundEffectId;
}

export const DEFAULT_AUDIO_GENERATION_PARAMS: AudioGenerationParams = {
  speechRate: 1,
  tone: 0,
  volume: 1,
  pitch: 0,
  intensity: 0,
  timbre: 0,
  soundEffect: "none",
};

function clampNum(n: unknown, min: number, max: number, fallback: number): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

export function normalizeAudioGenerationParams(raw: unknown): AudioGenerationParams {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const effectIds = AUDIO_SOUND_EFFECTS.map((e) => e.id) as string[];
  const soundEffect =
    typeof o.soundEffect === "string" && effectIds.includes(o.soundEffect)
      ? (o.soundEffect as AudioSoundEffectId)
      : DEFAULT_AUDIO_GENERATION_PARAMS.soundEffect;

  return {
    speechRate: clampNum(o.speechRate, 0.5, 2, DEFAULT_AUDIO_GENERATION_PARAMS.speechRate),
    tone: clampNum(o.tone, -12, 12, DEFAULT_AUDIO_GENERATION_PARAMS.tone),
    volume: clampNum(o.volume, 0, 2, DEFAULT_AUDIO_GENERATION_PARAMS.volume),
    pitch: clampNum(o.pitch, -12, 12, DEFAULT_AUDIO_GENERATION_PARAMS.pitch),
    intensity: clampNum(o.intensity, -100, 100, DEFAULT_AUDIO_GENERATION_PARAMS.intensity),
    timbre: clampNum(o.timbre, -100, 100, DEFAULT_AUDIO_GENERATION_PARAMS.timbre),
    soundEffect,
  };
}

/**
 * 写入 generationOptions 的 CosyVoice 可映射项（字符串，供 API dict[str,str]）。
 * 强度 / 音色调节 / 音效无官方字段，不透传。
 */
export function audioGenParamsToGenerationOptions(
  params: AudioGenerationParams
): Record<string, string> {
  const n = normalizeAudioGenerationParams(params);
  return {
    speechRate: String(n.speechRate),
    tone: String(n.tone),
    volume: String(n.volume),
    pitch: String(n.pitch),
  };
}
