# Holaday "Continue Editing" Design

## Status and scope

**Status:** approved product design; implementation has not started.

Holaday will extend video generation with a lightweight, AI-assisted "Continue Editing" capability. It is not a standalone editor, a new top-level navigation destination, or a self-built nonlinear video editor.

The capability applies to:

- ordinary generated videos;
- reference/recreation videos, retaining their reference and style context;
- IP-person videos, retaining the named locked-subject/identity-consistency constraint;
- videos uploaded by the user; and
- a selection of several compatible video results that the user wants combined.

The user-facing entry label is **Continue Editing** (`继续剪辑`). The editing panel is titled **AI Helps You Edit** (`AI 帮你剪辑`).

## Product principles

1. **Contextual, not a product within the product.** Continue Editing opens from a successful video result, a video history/file item, or video upload. It remains in the video experience.
2. **AI makes the edit; the user directs it.** Users can select guided operations or describe the outcome in natural language. Holaday turns the request into a limited, explainable scene-level change.
3. **Scene is the editing unit.** A multi-part result is a sequence of editable scenes. Holaday changes the smallest possible scope rather than regenerating the whole video.
4. **Preserve the original.** Every completed operation creates a version. The source video and every prior render remain recoverable.
5. **Cost is an affordance, not a confirmation dialog.** Free/reversible operations run directly. A paid generation action displays a small credit icon and amount in its button; pressing that button authorizes execution. The server remains the source of truth for pricing and debiting.
6. **No silent destructive AI edit.** AI may propose a rough cut, but it only changes the user's source after a direct user instruction or an explicit click on a guided action.

## Entry points

| Context | Entry | Default behavior |
| --- | --- | --- |
| A completed ordinary, recreation, or IP-person video | `继续剪辑` beside Download and Regenerate | Opens that video as an editing project. |
| A generated video in history or the Files video filter | `继续剪辑` | Reopens or creates the corresponding project. |
| Upload area on the video page | `上传视频，继续剪辑` | Ingests a user-owned video into a new editing project. |
| Several compatible video result cards selected together | `把选中的 N 段串成一条` | Creates a project with the selected results in order. |

The entry is hidden for failed, unavailable, or unauthorized artifacts. It does not appear as a global sidebar item.

## Interaction model

The initial panel contains:

- a video preview and current version selector;
- a short, ordered strip of scene cards with thumbnail, duration, source, captions, and operation state;
- an AI instruction composer, for example: "删掉中间停顿，把第 2 段改快一点";
- context-sensitive suggestions, such as "统一这 4 段节奏" or "为竖版重排字幕"; and
- Undo / version history.

A precise visual editor is progressively disclosed, not required. It embeds the selected editing SDK's trimmed timeline/canvas controls in the same panel for operations such as exact trim, scene reorder, subtitle timing, and audio adjustment.

### Default editing constraints by source

| Source | Permitted default edits | Context retained for regeneration |
| --- | --- | --- |
| Ordinary generated video | trim, reorder, captions, audio, resize, replace/re-generate scene | original prompt and generation parameters |
| Recreation video | same operations | original reference assets and style constraints |
| IP-person video | same operations, except identity-changing replacement | locked-subject identity consistency and original source permissions |
| User upload | trim, remove pauses, captions, combine, audio, add generated inserts | original source asset; no implicit identity or style claim |

## Project and version model

Holaday owns a vendor-neutral editable-project record. The chosen SDK is an editing/runtime implementation, not the product's sole source of truth.

Each project records:

- owner and authorization context;
- original task IDs and uploaded source file IDs;
- ordered scenes, each with source type, asset reference, timeline range, captions, audio and generation context where available;
- canvas/output configuration (aspect ratio, dimensions, format);
- SDK project document/checkpoint;
- immutable version records with parent version, operation diff, render status, output file, credit debit reference, and timestamps.

Generated videos that have scene-level source data are imported as several scenes. Historical final-MP4-only artifacts are imported as one scene: they can be trimmed, captioned, re-framed, mixed, and overlaid, but cannot reliably regenerate an original individual shot.

## Execution flow

1. A generated artifact or uploaded video is ingested into an editable project.
2. For uploads, Holaday creates a preview rendition, extracts basic media metadata, detects candidate scene boundaries/silence, transcribes speech, and proposes editable scene cards. The original uploaded file is retained unchanged.
3. The user gives an instruction or clicks a suggested action.
4. The AI planning layer produces a typed operation plan constrained to the selected scene(s): e.g. trim ranges, reorder, update captions, replace asset, or regenerate a named scene.
5. Holaday shows the affected scene(s) and the resulting action. It executes no-cost edits directly. A generation action presents its server-priced `◈ N` button; the click is the authorization.
6. The execution layer applies the operation, creates a child version, emits progress, and produces a preview/render.
7. The new output is delivered through Holaday's existing artifact delivery path. The user can keep editing, compare versions, restore a version, or download.

## Provider boundary

### Primary: IMG.LY CE.SDK

Use IMG.LY CE.SDK for embedded browser editing UI, timeline/canvas operations, project checkpoints, preview, and supported rendering integration. It is selected for its mature white-label web editor, configurable controls, captions/audio/timeline functionality, and server-capable creative engine.

Before procurement and implementation, validate its commercial license, permitted deployment hostnames, server-render requirements, supported browser/codec matrix, and pricing for Holaday's intended usage.

### Fallback POC: Twick

Twick is the lower-cost/self-hosted fallback to evaluate if the IMG.LY commercial and operational terms do not fit. It can supply a React editing surface and self-managed render path, but Holaday then takes greater responsibility for rendering, browser compatibility, storage integration, monitoring, and support.

### Not a dependency: OpenMontage

OpenMontage may inform scene-review and production-gate interaction ideas. It is not used as the embedded editor or runtime because its agent-production scope is broader than this feature and its AGPL licensing is unsuitable as a default dependency for Holaday's product integration.

## Billing and authorization

- The client never computes a price or debits credit.
- The server produces a short-lived action quote for each paid operation, linked to user, project, base version, operation plan, and price.
- The visible CTA includes the price, for example `重新生成这一段  ◈ 12`. Clicking it atomically validates the quote, checks balance, debits credit, and begins the job.
- If balance is insufficient, execution does not begin; the UI states the shortfall and routes to the existing recharge path.
- A render or generation failure follows the established refund/credit policy and remains visible in version history.

## Security, privacy, and content boundaries

- Verify project ownership and asset authorization on every read, mutation, render, and download.
- Use short-lived, scoped URLs for editor/media access; never expose provider secrets to the browser.
- At upload, ask the user to confirm they have the rights to process and publish the video. Do not silently make a user upload public or reuse it as shared training/material.
- Preserve locked-subject constraints for IP-person edits, including scene re-generation; do not treat a generic replacement request as permission to alter the named subject.
- Enforce media type, duration, size, codec, and retention limits defined during implementation planning.

## First POC and acceptance criteria

The POC is intentionally narrow and uses the chosen SDK rather than custom timeline work.

It must demonstrate:

1. open a generated video from `继续剪辑` and perform a trim;
2. import two generated clips or one user upload and combine/reorder them;
3. transcribe/edit captions and export a 9:16 version;
4. regenerate exactly one generated scene with a visible `◈ N` action;
5. preserve the original and restore a previous version;
6. deliver the finished render through the existing authenticated artifact UX;
7. reject an attempted operation from a different user or stale paid action; and
8. prove cost/debit correctness, preview/render completion, undo behavior, and a supported-browser/codec baseline.

Measure: successful edit-to-export rate, median time to first preview, paid-action cost accuracy, render failure/refund rate, version-restore success rate, and how often users complete an edit without opening the precision timeline.

## Explicitly out of scope

- a standalone Video Editor navigation area;
- a self-built nonlinear timeline/canvas engine;
- professional multi-track post-production, keyframe/VFX tooling, collaborative live editing, or a stock-media marketplace;
- automatic destructive editing without a user instruction; and
- re-generating individual original shots where only a historical final MP4 exists.

## Follow-up after approval

Create an implementation plan only after this design is reviewed and accepted. The plan will include a licensing/technical spike for IMG.LY, an adapter contract, project/version persistence, billing action semantics, upload ingestion, and the POC test matrix. No production code is authorized by this design alone.
