/** 摄像机机身 / 镜头 / 焦距 / 光圈选项（产品截图） */

export interface CameraGearOption {
  id: string;
  label: string;
}

export const CAMERA_BODIES: CameraGearOption[] = [
  { id: "red_v_raptor", label: "Red V-Raptor" },
  { id: "arri_alexa_35", label: "ARRI Alexa 35" },
  { id: "sony_venice_2", label: "Sony Venice 2" },
  { id: "blackmagic_ursa", label: "Blackmagic URSA" },
];

export const CAMERA_LENSES: CameraGearOption[] = [
  { id: "cooke_panchro", label: "Cooke Panchro" },
  { id: "zeiss_supreme", label: "Zeiss Supreme" },
  { id: "canon_k35", label: "Canon K35" },
  { id: "panavision_primo", label: "Panavision Primo" },
];

export const CAMERA_FOCAL_LENGTHS: CameraGearOption[] = [
  { id: "24", label: "24" },
  { id: "35", label: "35" },
  { id: "50", label: "50" },
  { id: "85", label: "85" },
  { id: "125", label: "125" },
  { id: "135", label: "135" },
];

export const CAMERA_APERTURES: CameraGearOption[] = [
  { id: "f1.4", label: "f/1.4" },
  { id: "f2", label: "f/2" },
  { id: "f2.8", label: "f/2.8" },
  { id: "f4", label: "f/4" },
  { id: "f5.6", label: "f/5.6" },
  { id: "f8", label: "f/8" },
  { id: "f11", label: "f/11" },
  { id: "f16", label: "f/16" },
];

export interface CameraGearState {
  enabled: boolean;
  cameraId: string;
  lensId: string;
  focalId: string;
  apertureId: string;
}

export const DEFAULT_CAMERA_GEAR: CameraGearState = {
  enabled: false,
  cameraId: "red_v_raptor",
  lensId: "cooke_panchro",
  focalId: "125",
  apertureId: "f11",
};

export function parseCameraGear(raw: unknown): CameraGearState {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CAMERA_GEAR };
  const o = raw as Record<string, unknown>;
  return {
    // 仅显式 true 为开启；缺省 / false 均为关闭
    enabled: o.enabled === true,
    cameraId:
      typeof o.cameraId === "string" && CAMERA_BODIES.some((x) => x.id === o.cameraId)
        ? o.cameraId
        : DEFAULT_CAMERA_GEAR.cameraId,
    lensId:
      typeof o.lensId === "string" && CAMERA_LENSES.some((x) => x.id === o.lensId)
        ? o.lensId
        : DEFAULT_CAMERA_GEAR.lensId,
    focalId:
      typeof o.focalId === "string" && CAMERA_FOCAL_LENGTHS.some((x) => x.id === o.focalId)
        ? o.focalId
        : DEFAULT_CAMERA_GEAR.focalId,
    apertureId:
      typeof o.apertureId === "string" && CAMERA_APERTURES.some((x) => x.id === o.apertureId)
        ? o.apertureId
        : DEFAULT_CAMERA_GEAR.apertureId,
  };
}

export function cycleOption<T extends { id: string }>(
  list: T[],
  currentId: string,
  direction: 1 | -1
): string {
  const idx = Math.max(0, list.findIndex((x) => x.id === currentId));
  const next = (idx + direction + list.length) % list.length;
  return list[next]!.id;
}

export function buildCameraGearPromptSuffix(gear: CameraGearState): string {
  if (!gear.enabled) return "";
  const camera = CAMERA_BODIES.find((x) => x.id === gear.cameraId)?.label ?? gear.cameraId;
  const lens = CAMERA_LENSES.find((x) => x.id === gear.lensId)?.label ?? gear.lensId;
  const focal = CAMERA_FOCAL_LENGTHS.find((x) => x.id === gear.focalId)?.label ?? gear.focalId;
  const aperture = CAMERA_APERTURES.find((x) => x.id === gear.apertureId)?.label ?? gear.apertureId;
  return `电影机位与光学：${camera}，${lens} 镜头，焦距 ${focal}mm，光圈 ${aperture}`;
}
