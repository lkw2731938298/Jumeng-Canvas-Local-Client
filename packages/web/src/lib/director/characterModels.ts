import type { DirectorObject } from "@/types/director-scene";
import { lookupAsset, type Asset } from "@/lib/api/assets";
import { withBasePath } from "@/lib/basePath";
import { findBuiltinModel } from "@/lib/director/builtinModels";

/** Subcategory for director stage human GLB uploads in the asset panel. */
export const DIRECTOR_MODEL_SUBCATEGORY = "导演台人模";

export const GLB_ACCEPT = ".glb,.gltf,model/gltf-binary,model/gltf+json";

export function isGlbAsset(asset: Asset): boolean {
  const type = asset.fileType.toLowerCase();
  const url = asset.fileUrl.toLowerCase();
  return (
    type.includes("gltf") ||
    url.endsWith(".glb") ||
    url.endsWith(".gltf")
  );
}

export function resolveCharacterModelUrl(
  object: DirectorObject,
  assets: Asset[] | Map<string, Asset> | undefined
): string | null {
  if (object.kind !== "character") return null;
  if (object.modelAssetId) {
    const asset = lookupAsset(assets, object.modelAssetId);
    if (!asset || !isGlbAsset(asset)) return null;
    return asset.fileUrl;
  }
  if (object.builtinModelId) {
    const preset = findBuiltinModel(object.builtinModelId);
    if (preset?.glbPath && !object.builtinModelId.startsWith("mannequin_")) {
      return withBasePath(preset.glbPath);
    }
    if (object.builtinModelId.startsWith("mannequin_")) return null;
  }
  if (object.kind === "character" && object.shape === "model") {
    const mannequin = findBuiltinModel("mannequin_male");
    if (mannequin?.glbPath && object.builtinModelId?.startsWith("mannequin_")) return null;
    const humanoid = findBuiltinModel("humanoid_robot");
    if (humanoid?.glbPath) return withBasePath(humanoid.glbPath);
  }
  return null;
}
