/**
 * 内置技能：photo-relic-editorial（Codex Skill 包格式，精简可运行版）。
 * 完整上游：https://github.com/wnby/photo-relic-editorial
 */

import type { AgentSkillDetail } from "./parse";

const BODY = `# Photo Relic Editorial

## Overview

Transform a user-provided photograph into a vertical editorial artwork: the real photograph above, and a "Photo Relic" below. The relic is a compressed visual memory of the photograph — a few precise marks that preserve subject identity, light, weight, and emotional temperature. Feel like real photography meeting a modern paper print.

This is a creative image-generation skill. When producing the final image, use \`media_generate_image\` with the user's photo as the reference image. First use \`media_inspect_images\` on the source photo.

## Workflow

1. Inspect the supplied photograph (\`media_inspect_images\`) before writing the generation prompt.
2. Identify 3-5 source cues: subject identity relationship, emotional core concept, dominant colors + optional warm accent, light/shadow direction, key structural cues.
3. Choose a compact recipe: layout rhythm / relic grammar / mark weight / title mode / motion seed.
4. Read reference \`afterimage-editorial-prompt.md\` (via skill_read_reference) before composing the final image prompt.
5. Ask for the missing photo only if no usable source image is available.
6. Generate one finished vertical artwork with \`media_generate_image\` (referenceNodeIds = source photo node) unless the user asks for variants. Prefer aspect 3:4 or 9:16.
7. Use the Quality Gate before finalizing. If a major gate fails, regenerate once with tighter constraints.

## Signature Aesthetic

- Preserve the photographic region as truth.
- Warm ivory / off-white / quiet source-light panel for the relic area.
- Deep blue, ink black, gray-green, stone gray, muted teal + one small warm accent when source supports it.
- One primary form + few support marks; generous blank space; small poetic title or none.
- Modern printmaking: flat ink blocks, softened edges, negative-space cuts, measured irregularity.

## Creative Rules

- Do not redraw, beautify, expand, or invent content in the photographic region.
- Relic must come from the photo's real colors, light, edges, placement, and spatial tension.
- Prefer quiet precision over ornament.
- Avoid loud gradients, commercial posters, heavy watercolor, fake vintage, stickers, collage, UI overlays, watermarks.

## Quality Gate

- Photo remains truthful and recognizable.
- Relic recognizable at thumbnail size and preserves full subject relationship.
- Lower panel feels like memory print, not illustration / infographic / generic poster.
- Series signature: warm paper, deep ink, sparse marks, optional accent, quiet title.
- No UI overlays / watermarks / unrelated decorations.
`;

const REF_PROMPT = `# Photo Relic Prompt Guide

Create a vertical editorial artwork from the user's photograph: real photography above, restrained modern print (Photo Relic) below. Relic = compressed memory of the photo — recognizable but not literal.

## Prompt Compiler

Before the final generation prompt, pick:

- layout rhythm: photo-over-paper | deep-paper | axis-diptych | horizon-cover | social-cover
- relic grammar: ink-seal architecture | stacked-order | skyline-memory | light-relic | edge-remnant
- mark weight: quiet ink | graphic ink | thin trace | single accent
- title mode: small English title | small Chinese title | textless | micro bilingual
- motion seed: outline descent | ink assembly | light fade | still only

## Required constraints in the image prompt

- Keep the original photograph truthful; do not redraw faces/buildings/scene in the photo region.
- Abstraction only in the relic region.
- One clear primary relic shape; warm ivory paper or restrained source-light field.
- Modern printmaking marks; at most one small warm source-derived accent.
- Tiny title or none; vertical 3:4 / 4:5 / 9:16 friendly.

## Template

Create a vertical Photo Relic editorial artwork using the supplied photograph. Recipe: [layout] / [grammar] / [weight] / [title] / [motion]. Preserve the photograph as a real truthful region (no redraw, no invented content, no beauty filter). Pair with a lower warm ivory paper relic derived only from the photo's subject identity, light, color, edges, scale, and emotional concept. One recognizable primary relic with modern printmaking language and generous blank space. Then add 2-4 photo-specific sentences naming visible cues.
`;

export const PHOTO_RELIC_SKILL: AgentSkillDetail = {
  slug: "photo-relic-editorial",
  name: "photo-relic-editorial",
  description:
    "Create Photo Relic editorial artworks from user photographs: real photo above, quiet paper-memory relic below. Use for minimal art, photographic relic posters, abstract editorial photography, gallery-like photo posters.",
  source: "bundled",
  body: BODY,
  references: {
    "afterimage-editorial-prompt.md": REF_PROMPT,
  },
};

export const BUNDLED_SKILLS: AgentSkillDetail[] = [PHOTO_RELIC_SKILL];
