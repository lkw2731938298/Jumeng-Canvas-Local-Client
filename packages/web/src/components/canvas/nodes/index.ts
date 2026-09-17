export { PromptNode } from "./PromptNode";
export { ModelLoaderNode } from "./ModelLoaderNode";
export { KSamplerNode } from "./KSamplerNode";
export { VAEDecodeNode, ImagePreviewNode, ImageInputNode, TextInputNode, LoRANode, UpscaleNode, LLMTextNode, VideoInputNode, AudioInputNode } from "./more-nodes";
export { StoryboardGridNode } from "./StoryboardGridNode";
export { FinishedClipsGridNode } from "./FinishedClipsGridNode";
export { OverseasLocalizeNode } from "./OverseasLocalizeNode";
export { DirectorStageNode } from "./DirectorStageNode";
export { DocumentInputNode } from "./DocumentInputNode";
export { NodeGroupFrame } from "./NodeGroupFrame";

import { PromptNode } from "./PromptNode";
import { ModelLoaderNode } from "./ModelLoaderNode";
import { KSamplerNode } from "./KSamplerNode";
import { VAEDecodeNode, ImagePreviewNode, ImageInputNode, TextInputNode, LoRANode, UpscaleNode, LLMTextNode, VideoInputNode, AudioInputNode } from "./more-nodes";
import { StoryboardGridNode } from "./StoryboardGridNode";
import { FinishedClipsGridNode } from "./FinishedClipsGridNode";
import { OverseasLocalizeNode } from "./OverseasLocalizeNode";
import { DirectorStageNode } from "./DirectorStageNode";
import { DocumentInputNode } from "./DocumentInputNode";
import { NodeGroupFrame } from "./NodeGroupFrame";
import type { ComponentType } from "react";

export const NODE_COMPONENTS: Record<string, ComponentType<any>> = {
  prompt: PromptNode,
  model_loader: ModelLoaderNode,
  ksampler: KSamplerNode,
  vae_decode: VAEDecodeNode,
  image_preview: ImagePreviewNode,
  image_input: ImageInputNode,
  text_input: TextInputNode,
  document_input: DocumentInputNode,
  lora: LoRANode,
  upscale: UpscaleNode,
  llm_text: LLMTextNode,
  video_input: VideoInputNode,
  audio_input: AudioInputNode,
  storyboard_grid: StoryboardGridNode,
  finished_clips_grid: FinishedClipsGridNode,
  overseas_localize: OverseasLocalizeNode,
  director_stage: DirectorStageNode,
  node_group: NodeGroupFrame,
};
