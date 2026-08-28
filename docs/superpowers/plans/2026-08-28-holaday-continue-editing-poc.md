# Holaday Continue Editing POC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a feature-gated, user-owned “继续剪辑” vertical slice that opens an existing or uploaded video, applies bounded scene-level edits, preserves immutable versions, and exports a new Holaday file without exposing supplier credentials or charging outside the server.

**Architecture:** Holaday owns the project, scene, version, quote, and file-delivery records. A narrow `VideoEditorAdapter` hides IMG.LY CE.SDK behind a browser-only lazy import; the POC runs in CE.SDK evaluation mode locally and stays disabled in production until a commercial license and browser/codec gate are approved. The first vertical slice supports trim, reorder, captions, 9:16 reframing, restore, and export; paid scene regeneration is represented by a server-authoritative quoted operation and reuses the existing video generation/task boundary rather than letting the browser deduct quota.

**Tech Stack:** React 18, Vite 6, TypeScript 5.7, tRPC 11, Drizzle ORM/MySQL, Vitest, Testing Library, Zustand, IMG.LY `@cesdk/cesdk-js` Web SDK, existing Holaday `FileService`/R2 delivery.

**Spec:** `docs/superpowers/specs/2026-08-28-holaday-continue-editing-design.md`

## Global Constraints

- The user-facing entry is `继续剪辑`; the panel title is `AI 帮你剪辑`; no new top-level navigation item is allowed.
- The original video is immutable and every completed edit creates a child version.
- The browser never calculates price, deducts quota, or receives supplier secrets.
- A paid operation is authorized only by clicking a server-priced `◈ N` action; the quote is bound to user, project, base version, operation plan, and expiry.
- A final MP4 without scene-level source metadata imports as one scene and may be trimmed, captioned, reframed, mixed, or overlaid, but not falsely offered single-shot regeneration.
- IP-person projects preserve the named locked-subject constraint for every scene regeneration.
- All project, media, version, quote, render, restore, and download reads/writes enforce ownership.
- URLs for source media and exports are short-lived and scoped; no vendor key is rendered into HTML, logs, task results, or persisted client state.
- `VIDEO_EDITING_ENABLED` defaults to `false`; `VIDEO_EDITING_ALLOWLIST` defaults to empty; production stays off until the commercial-license gate is explicitly satisfied.
- DivineAPI Translator and its OpenAI-key configuration remain untouched.
- The POC does not build a custom nonlinear timeline, professional VFX/keyframes, collaborative editing, or a media marketplace.
- IMG.LY production release requires a commercial quote and licensed app identifiers. The official pricing page documents custom pricing and a 30-day full-feature trial: https://img.ly/pricing/
- The POC uses the standard CE.SDK video editor and client-side export documented at https://support.img.ly/how-to-get-started-with-the-video-editor-in-ce-sdk and https://img.ly/products/video-sdk/.

---

### Task 1: Lock the supplier boundary and feature gate

**Files:**
- Modify: `apps/orchestrator/src/config/env.ts`
- Test: `apps/orchestrator/src/config/env.video-editing.test.ts`
- Create: `apps/web-workbench/src/features/video-editing/video-editor-adapter.ts`
- Create: `apps/web-workbench/src/features/video-editing/cesdk-video-editor-adapter.ts`
- Test: `apps/web-workbench/src/features/video-editing/video-editor-adapter.test.ts`
- Modify: `apps/web-workbench/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `docs/operations/video-editing-poc-gate.md`

**Interfaces:**
- Produces: `VIDEO_EDITING_ENABLED: boolean`, `VIDEO_EDITING_ALLOWLIST: string`, `VIDEO_EDITING_PROVIDER: 'cesdk'`, and `CESDK_LICENSE: string` in the validated server environment.
- Produces: `VideoEditorAdapter.mount(input): Promise<MountedVideoEditor>` and `MountedVideoEditor.destroy(): Promise<void>`.
- Consumes later: Tasks 6 and 8 call the adapter; no other UI module imports `@cesdk/cesdk-js` directly.

- [ ] **Step 1: Write failing environment tests**

```ts
it('keeps video editing off without an explicit flag', () => {
  const parsed = envSchema.parse(minimalEnv());
  expect(parsed.VIDEO_EDITING_ENABLED).toBe(false);
  expect(parsed.VIDEO_EDITING_ALLOWLIST).toBe('');
  expect(parsed.VIDEO_EDITING_PROVIDER).toBe('cesdk');
  expect(parsed.CESDK_LICENSE).toBe('');
});

it('parses the guarded CE.SDK configuration', () => {
  const parsed = envSchema.parse({
    ...minimalEnv(),
    VIDEO_EDITING_ENABLED: 'true',
    VIDEO_EDITING_ALLOWLIST: 'usr_one,usr_two',
    CESDK_LICENSE: 'evaluation-license',
  });
  expect(parsed.VIDEO_EDITING_ENABLED).toBe(true);
  expect(parsed.VIDEO_EDITING_ALLOWLIST).toBe('usr_one,usr_two');
});
```

- [ ] **Step 2: Run the environment tests and verify they fail**

Run: `pnpm --filter @holaday/orchestrator test -- src/config/env.video-editing.test.ts`

Expected: FAIL because the four video-editing fields do not exist.

- [ ] **Step 3: Add the validated feature gate**

```ts
VIDEO_EDITING_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
VIDEO_EDITING_ALLOWLIST: z.string().default(''),
VIDEO_EDITING_PROVIDER: z.literal('cesdk').default('cesdk'),
CESDK_LICENSE: z.string().default(''),
```

- [ ] **Step 4: Write the adapter contract test**

```ts
it('destroys a mounted editor exactly once', async () => {
  const destroy = vi.fn().mockResolvedValue(undefined);
  const mounted = createMountedVideoEditorForTest({ destroy });
  await mounted.destroy();
  await mounted.destroy();
  expect(destroy).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 5: Implement the only allowed CE.SDK import boundary**

```ts
export interface VideoEditorMountInput {
  container: HTMLElement;
  license: string | null;
  sceneDocument: string | null;
  sourceUrl: string;
  locale: 'zh-CN';
  onDocumentChanged(document: string): void;
}

export interface MountedVideoEditor {
  exportMp4(): Promise<Blob>;
  serialize(): Promise<string>;
  destroy(): Promise<void>;
}

export interface VideoEditorAdapter {
  mount(input: VideoEditorMountInput): Promise<MountedVideoEditor>;
}
```

`cesdk-video-editor-adapter.ts` must dynamically import `@cesdk/cesdk-js`, load the standard video scene, hide unsupported advanced panels, set `zh-CN`, and return idempotent cleanup. Passing an empty license uses evaluation mode only; the operations runbook must state that its watermarked output is never a production release artifact.

- [ ] **Step 6: Install the pinned SDK and document the release gate**

Run: `pnpm --filter @holaday/web-workbench add @cesdk/cesdk-js`

In `docs/operations/video-editing-poc-gate.md`, record these blocking production fields: commercial contract owner, licensed hostnames (`holaday.ai`, `hd-app.orangebench.tech`, staging hostname), export-count terms, server-rendering terms, browser/codec matrix, data-transmission review, SLA, cancellation notice, and rollback owner. Do not record a license value.

- [ ] **Step 7: Verify and commit**

Run:

```bash
pnpm --filter @holaday/orchestrator test -- src/config/env.video-editing.test.ts
pnpm --filter @holaday/web-workbench test -- src/features/video-editing/video-editor-adapter.test.ts
pnpm --filter @holaday/web-workbench typecheck
```

Expected: all pass.

Commit: `feat(video-editing): add guarded editor adapter`

---

### Task 2: Persist user-owned projects, immutable versions, and action quotes

**Files:**
- Create: `apps/orchestrator/src/db/schema/video-editing.ts`
- Test: `apps/orchestrator/src/db/schema/video-editing.test.ts`
- Modify: `apps/orchestrator/src/db/schema/index.ts`
- Create: `apps/orchestrator/drizzle/0049_video_editing_projects.sql`
- Modify: `apps/orchestrator/scripts/verify-db-schema.ts`
- Create: `apps/orchestrator/src/video-editing/types.ts`
- Create: `apps/orchestrator/src/video-editing/project-repository.ts`
- Test: `apps/orchestrator/src/video-editing/project-repository.test.ts`

**Interfaces:**
- Produces: `VideoEditScene`, `VideoEditDocument`, `VideoEditOperation`, `VideoEditProjectRecord`, and `VideoEditVersionRecord`.
- Produces: `VideoEditProjectRepository.createFromSource`, `.getOwnedProject`, `.appendVersion`, `.restoreVersion`, `.createQuote`, and `.consumeQuote`.
- Consumes later: Tasks 3–9 use only the repository, not raw table access.

- [ ] **Step 1: Write failing schema contract tests**

Assert exact columns and ownership/index constraints for:

```ts
videoEditProjects: externalId, userId, sourceTaskId, sourceFileId, sourceKind,
  provider, status, currentVersionId, createdAt, updatedAt
videoEditVersions: externalId, projectId, parentVersionId, revision,
  documentJson, operationJson, sdkDocument, outputFileId, renderStatus, createdAt
videoEditActionQuotes: externalId, userId, projectId, baseVersionId,
  operationHash, operationJson, costUnits, status, expiresAt, consumedAt, createdAt
```

Assert unique keys on project/version/quote external IDs and `(project_id, revision)`, plus lookup indexes `(user_id, updated_at)`, `(project_id, created_at)`, and `(user_id, status, expires_at)`.

- [ ] **Step 2: Run the schema test and verify it fails**

Run: `pnpm --filter @holaday/orchestrator test -- src/db/schema/video-editing.test.ts`

Expected: FAIL because the schema exports do not exist.

- [ ] **Step 3: Add schema and numbered migration**

Use MySQL `JSON` for `document_json` and `operation_json`, `MEDIUMTEXT` for the vendor document, `BIGINT UNSIGNED` for internal foreign keys, and `DATETIME(3)` for timestamps. Foreign keys cascade from user/project, but `source_task_id`, `source_file_id`, and `output_file_id` use `ON DELETE SET NULL` so project history remains explainable when a retained artifact expires.

- [ ] **Step 4: Define the vendor-neutral document contract**

```ts
export type VideoEditSourceKind = 'generated' | 'clone' | 'ip_person' | 'upload';

export interface VideoEditScene {
  id: string;
  sourceFileId: string;
  sourceStartMs: number;
  sourceEndMs: number;
  order: number;
  caption: string;
  audioGain: number;
  generationContext: {
    sourceTaskId?: string;
    prompt?: string;
    referenceFileIds?: string[];
    lockedSubjectFileId?: string;
  } | null;
}

export interface VideoEditDocument {
  aspectRatio: '16:9' | '9:16' | '1:1';
  scenes: VideoEditScene[];
}

export type VideoEditOperation =
  | { kind: 'trim'; sceneId: string; startMs: number; endMs: number }
  | { kind: 'reorder'; sceneIds: string[] }
  | { kind: 'caption'; sceneId: string; text: string }
  | { kind: 'aspect_ratio'; value: VideoEditDocument['aspectRatio'] }
  | { kind: 'remove_silence'; sceneId: string; ranges: Array<{ startMs: number; endMs: number }> }
  | { kind: 'regenerate_scene'; sceneId: string; prompt: string };
```

- [ ] **Step 5: Write repository ownership and immutability tests**

Tests must prove:

1. `getOwnedProject(projectId, ownerA)` returns the project and `ownerB` gets `NOT_FOUND`.
2. `appendVersion` increments revision under a transaction and never updates a previous version row.
3. `restoreVersion` creates a child version of the current version instead of moving the pointer backward silently.
4. `consumeQuote` succeeds once only when owner, project, base version, operation hash, status, and expiry all match.

- [ ] **Step 6: Implement repository transactions**

`appendVersion` must lock the project row, verify `currentVersionId === baseVersionId`, insert the child version, then update only `current_version_id` and `updated_at`. `consumeQuote` must atomically transition `pending → consumed`; expired, mismatched, or already-consumed quotes return typed outcomes and do not mutate quota.

- [ ] **Step 7: Verify migration contract and commit**

Run:

```bash
pnpm --filter @holaday/orchestrator test -- src/db/schema/video-editing.test.ts src/video-editing/project-repository.test.ts
pnpm --filter @holaday/orchestrator typecheck
pnpm --filter @holaday/orchestrator test -- scripts/release-db-contract.test.mjs
```

Expected: all pass.

Commit: `feat(video-editing): persist projects and versions`

---

### Task 3: Import only owned and available source videos

**Files:**
- Create: `apps/orchestrator/src/video-editing/source-import.ts`
- Test: `apps/orchestrator/src/video-editing/source-import.test.ts`
- Modify: `apps/orchestrator/src/files/file-service.ts`
- Test: `apps/orchestrator/src/files/file-service-storage-integration.test.ts`

**Interfaces:**
- Produces: `importVideoSource(input): Promise<ImportedVideoSource>`.
- Produces: `FileService.getScopedPreviewForUser(fileId, userId, ttlSeconds)` returning a short-lived URL or the authenticated download path plus expiry.
- Consumes: Task 2 repository/types; existing task result metadata and `task_files` rows.
- Consumed later by: Task 5 router and Task 6 editor shell.

- [ ] **Step 1: Write source-access failure tests**

Cover foreign file, expired file, inactive file, missing task attachment, non-video MIME, and a generated IP-person video whose locked-subject metadata is missing. Every failure returns `NOT_FOUND` or a typed unavailable reason without leaking whether another user's file exists.

- [ ] **Step 2: Write successful import tests**

```ts
expect(await importVideoSource(generatedWithScenes)).toMatchObject({
  sourceKind: 'generated',
  document: { scenes: [{ generationContext: { sourceTaskId: 'task_owned' } }] },
});

expect(await importVideoSource(finalMp4Only)).toMatchObject({
  document: { scenes: [{ sourceStartMs: 0, order: 0, generationContext: null }] },
  capabilities: { sceneRegeneration: false },
});
```

- [ ] **Step 3: Run the tests and verify they fail**

Run: `pnpm --filter @holaday/orchestrator test -- src/video-editing/source-import.test.ts`

Expected: FAIL because the import service does not exist.

- [ ] **Step 4: Implement owned-source import and preview URLs**

Generated videos use structured task metadata only when it belongs to the caller and points to active file rows. Uploaded/final-only MP4s become one scene. `ip_person` imports require `lockedSubjectFileId` in generation context and preserve it unchanged. Short-lived preview access defaults to 15 minutes and is never persisted in `document_json`.

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter @holaday/orchestrator test -- src/video-editing/source-import.test.ts src/files/file-service-storage-integration.test.ts
pnpm --filter @holaday/orchestrator typecheck
```

Expected: all pass.

Commit: `feat(video-editing): import owned video sources`

---

### Task 4: Plan bounded edits without silent destructive changes

**Files:**
- Create: `apps/orchestrator/src/video-editing/operation-schema.ts`
- Test: `apps/orchestrator/src/video-editing/operation-schema.test.ts`
- Create: `apps/orchestrator/src/video-editing/instruction-planner.ts`
- Test: `apps/orchestrator/src/video-editing/instruction-planner.test.ts`

**Interfaces:**
- Produces: `planVideoEditInstruction({ instruction, document, sourceKind }): Promise<VideoEditPlan>`.
- `VideoEditPlan` is `{ summary: string; affectedSceneIds: string[]; operations: VideoEditOperation[]; requiresQuote: boolean }`.
- Consumed later by: Task 5 `planInstruction` endpoint and Task 6 confirmation UI.

- [ ] **Step 1: Write failing operation-validation tests**

Reject unknown operation kinds, scene IDs not in the base document, negative or reversed trim ranges, reorder lists that omit/duplicate scenes, captions over 500 characters, empty regeneration prompts, and regeneration on a scene whose `generationContext` is null. Reject an IP-person regeneration if the plan removes or changes `lockedSubjectFileId`.

- [ ] **Step 2: Add the strict Zod plan schema**

Use a discriminated union keyed by `kind`; parse model output with `.strict()` objects and cap the entire operation list at 20 items. Compute `requiresQuote` on the server from operation kinds; never trust it from model output.

- [ ] **Step 3: Write planner behavior tests**

Tests use an injected fake planner client and prove:

1. “删掉第 2 段开头 1 秒” yields one trim operation affecting scene 2.
2. “把第 3 段放到最前面” yields an exact reorder of all scene IDs.
3. “改成竖版并把第 1 段字幕改为开场” yields aspect-ratio and caption operations.
4. “帮我优化一下” returns a preview-only suggestion and no operations because intent is ambiguous.
5. Model timeouts return `planner_unavailable`; they do not execute edits.

- [ ] **Step 4: Implement the injected planner boundary**

```ts
export interface VideoEditPlannerClient {
  plan(input: { instruction: string; document: VideoEditDocument; sourceKind: VideoEditSourceKind }): Promise<unknown>;
}
```

Use the existing server OpenAI credential through a dedicated client factory only when `VIDEO_EDITING_ENABLED=true`; do not add or change any key. The system prompt enumerates the six allowed operation kinds, forbids identity changes, and requires the model to return JSON only. Validate the response again against the current document before returning it.

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter @holaday/orchestrator test -- src/video-editing/operation-schema.test.ts src/video-editing/instruction-planner.test.ts
pnpm --filter @holaday/orchestrator typecheck
```

Expected: all pass.

Commit: `feat(video-editing): plan bounded scene edits`

---

### Task 5: Expose an allowlisted, ownership-safe editing API

**Files:**
- Create: `apps/orchestrator/src/trpc/routers/video-editing.ts`
- Test: `apps/orchestrator/src/trpc/routers/video-editing.test.ts`
- Modify: `apps/orchestrator/src/trpc/router.ts`
- Create: `apps/orchestrator/src/video-editing/feature-access.ts`
- Test: `apps/orchestrator/src/video-editing/feature-access.test.ts`
- Create: `apps/orchestrator/src/video-editing/quote-service.ts`
- Test: `apps/orchestrator/src/video-editing/quote-service.test.ts`

**Interfaces:**
- Produces tRPC procedures: `videoEditing.capability`, `.createProject`, `.getProject`, `.planInstruction`, `.applyFreeOperations`, `.quotePaidOperation`, `.consumePaidOperation`, `.saveSdkDocument`, and `.restoreVersion`.
- Consumes Tasks 1–4.
- Consumed later by Tasks 6–9 through the typed web client.

- [ ] **Step 1: Write feature-access tests**

Prove: flag off denies all mutating procedures; flag on plus empty allowlist permits all authenticated users; non-empty allowlist permits only exact external IDs; capability reports `enabled: false` without revealing allowlist contents or license state.

- [ ] **Step 2: Write router ownership and stale-base tests**

Every procedure must return `NOT_FOUND` for a foreign project/version/file. `applyFreeOperations` and `saveSdkDocument` require the supplied base version to equal the project's current version or return `CONFLICT`. `restoreVersion` validates the target belongs to the project and creates a child version.

- [ ] **Step 3: Write quote tests before implementation**

Use a canonical JSON hash of `{ projectId, baseVersionId, operations }`. Free operations return no quote. `regenerate_scene` returns a 10-minute pending quote with server-owned `costUnits`. A changed operation, changed base version, foreign user, expired quote, or replayed quote cannot be consumed. A failed downstream generation calls the existing quota refund path exactly once.

- [ ] **Step 4: Implement the router and quote service**

The router returns scene/document data and fresh preview URLs but never raw internal IDs, storage paths, environment fields, or vendor credentials. `consumePaidOperation` calls one repository transaction that consumes quota and quote, then starts the existing video generation path with `source_context` containing project/version/scene IDs and locked-subject metadata.

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter @holaday/orchestrator test -- src/video-editing/feature-access.test.ts src/video-editing/quote-service.test.ts src/trpc/routers/video-editing.test.ts
pnpm --filter @holaday/orchestrator typecheck
```

Expected: all pass.

Commit: `feat(video-editing): add project editing api`

---

### Task 6: Build the embedded “AI 帮你剪辑” project panel

**Files:**
- Create: `apps/web-workbench/src/features/video-editing/VideoEditingPanel.tsx`
- Create: `apps/web-workbench/src/features/video-editing/VideoEditingPanel.test.tsx`
- Create: `apps/web-workbench/src/features/video-editing/SceneStrip.tsx`
- Create: `apps/web-workbench/src/features/video-editing/SceneStrip.test.tsx`
- Create: `apps/web-workbench/src/features/video-editing/VersionHistory.tsx`
- Create: `apps/web-workbench/src/features/video-editing/VersionHistory.test.tsx`
- Create: `apps/web-workbench/src/features/video-editing/video-editing-state.ts`
- Test: `apps/web-workbench/src/features/video-editing/video-editing-state.test.ts`
- Modify: `apps/web-workbench/src/App.tsx`

**Interfaces:**
- Produces route: `/video/edit/:projectId` within the existing authenticated `AppShell`; this is a deep route, not a sidebar item.
- Produces state transitions: `loading → ready → planning → plan_ready → applying/rendering → ready | error`.
- Consumes: Task 1 adapter and Task 5 tRPC API.

- [ ] **Step 1: Write reducer tests for concurrency and failure states**

The reducer ignores stale request IDs, never hides the previous usable version during a failed plan/apply request, disables duplicate submits, and exposes explicit `planner_unavailable`, `stale_version`, `insufficient_balance`, `render_failed`, and `source_unavailable` states.

- [ ] **Step 2: Write panel interaction tests**

Tests prove:

1. The screen title is `AI 帮你剪辑` and the primary context is the current video, not a blank editor.
2. Scene cards expose thumbnail, duration, source, caption, selected state, and operation state.
3. Entering “改成竖版并更新第一段字幕” previews affected scenes before apply.
4. A free plan applies immediately from `应用这 2 项修改`.
5. A paid plan shows `重新生成这一段  ◈ 12`; click calls the exact quote ID once.
6. Version restore warns that it creates a new version and preserves the source.
7. All icon-only controls have both `aria-label` and native `title`.

- [ ] **Step 3: Implement the low-noise Holaday shell**

Use the existing neutral page background, white cards, 28px outer radius, 8px control radius, and Holaday pink only for primary/action state. Layout at desktop: preview/editor on the left; current version and compact scene strip below; instruction, suggestions, plan preview, and versions on the right. On narrow screens, stack preview → scene strip → instruction → actions. Do not add decorative fake assets or a professional-editor toolbar.

- [ ] **Step 4: Mount CE.SDK only after project data and container are ready**

`VideoEditingPanel` dynamically loads Task 1's adapter, passes a fresh scoped source URL, maps `sdkDocument`, and always destroys the editor on route/project change and unmount. If the SDK fails to load, keep the source preview and scene-level controls usable and show `精细时间线暂不可用` rather than a blank pane.

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter @holaday/web-workbench test -- src/features/video-editing
pnpm --filter @holaday/web-workbench typecheck
pnpm --filter @holaday/web-workbench lint
```

Expected: all pass.

Commit: `feat(video-editing): add embedded editing panel`

---

### Task 7: Add entry points for generated, uploaded, and selected compatible videos

**Files:**
- Modify: `apps/web-workbench/src/pages/VideoPage.tsx`
- Modify: `apps/web-workbench/src/lib/video-history-row.ts`
- Test: `apps/web-workbench/src/lib/video-history-row.test.ts`
- Modify: `apps/web-workbench/src/pages/FilesPage.tsx`
- Create: `apps/web-workbench/src/features/video-editing/video-edit-entry.ts`
- Test: `apps/web-workbench/src/features/video-editing/video-edit-entry.test.ts`
- Modify: `apps/web-workbench/src/pages/video-page-style-state.test.ts`

**Interfaces:**
- Produces: `canContinueEditing(row)`, `canCombineVideoRows(rows)`, and `createVideoEditingProject(sourceFileIds)`.
- Consumes: Task 5 `capability/createProject` and the existing `VideoRow`/`UiFile` types.

- [ ] **Step 1: Write entry-visibility tests**

`继续剪辑` appears only for owned, active, downloadable video artifacts in `completed` or `partial_success` tasks. It is absent for failed, unavailable, expired, image, or foreign artifacts and when the feature capability is off.

- [ ] **Step 2: Write compatible multi-select tests**

Compatibility requires video MIME, active availability, same owner by construction, supported duration/codec metadata, and no duplicate file IDs. Selection order is preserved. The CTA reads `把选中的 N 段串成一条` and is disabled with an explainable reason when any selected item is incompatible.

- [ ] **Step 3: Implement result/history and file-library entries**

Add `继续剪辑` beside existing download/regenerate actions in completed result/history cards. In the file library's video filter, add the same action to the always-visible action group or More menu without replacing `用于新任务`. Do not add a global navigation item.

- [ ] **Step 4: Implement `上传视频，继续剪辑`**

Reuse the existing direct-to-R2 media upload helper and allowlist. After upload confirmation, call `createProject` with the file ID and navigate to `/video/edit/:projectId`. Keep the current 200MB paid-plan cap; do not introduce a second upload implementation.

- [ ] **Step 5: Verify and commit**

Run:

```bash
pnpm --filter @holaday/web-workbench test -- src/features/video-editing/video-edit-entry.test.ts src/lib/video-history-row.test.ts src/pages/video-page-style-state.test.ts
pnpm --filter @holaday/web-workbench typecheck
pnpm --filter @holaday/web-workbench lint
```

Expected: all pass.

Commit: `feat(video-editing): connect continue editing entries`

---

### Task 8: Export, retain, restore, and deliver rendered versions

**Files:**
- Create: `apps/orchestrator/src/video-editing/render-service.ts`
- Test: `apps/orchestrator/src/video-editing/render-service.test.ts`
- Modify: `apps/orchestrator/src/trpc/routers/video-editing.ts`
- Modify: `apps/web-workbench/src/features/video-editing/VideoEditingPanel.tsx`
- Modify: `apps/web-workbench/src/features/video-editing/VideoEditingPanel.test.tsx`

**Interfaces:**
- Produces: `videoEditing.beginExport`, `.completeClientExport`, and `.failExport`.
- `beginExport` returns an upload target scoped to `{ userId, projectId, versionId, renderAttemptId }`.
- `completeClientExport` returns the existing `FileDownloadPayload` shape.

- [ ] **Step 1: Write export security and idempotency tests**

Prove: only the current owned version can start export; upload completion verifies object presence, real size, `video/mp4`, max duration/size metadata, and render attempt; repeat completion returns the same output file; a foreign, expired, failed, or mismatched attempt cannot attach output.

- [ ] **Step 2: Write render-state tests**

State changes are `idle → rendering → completed | failed`; only `completed` sets `outputFileId`. Failure leaves the prior completed version downloadable. Restoring an old version never deletes its output.

- [ ] **Step 3: Implement client export and existing file delivery**

The web panel calls `MountedVideoEditor.exportMp4()`, uploads the Blob to the server-issued target, confirms it, and renders the standard `FileDownloadCard`. Server completion creates an `output` `task_files` record through `FileService`, with existing output retention and authenticated/signed download behavior.

- [ ] **Step 4: Verify and commit**

Run:

```bash
pnpm --filter @holaday/orchestrator test -- src/video-editing/render-service.test.ts src/trpc/routers/video-editing.test.ts
pnpm --filter @holaday/web-workbench test -- src/features/video-editing/VideoEditingPanel.test.tsx
pnpm --filter @holaday/orchestrator typecheck
pnpm --filter @holaday/web-workbench typecheck
```

Expected: all pass.

Commit: `feat(video-editing): export immutable video versions`

---

### Task 9: Prove the POC and keep production off until licensing is approved

**Files:**
- Create: `apps/web-workbench/qa-video-editing.html`
- Create: `apps/web-workbench/src/features/video-editing/video-editing-e2e.test.tsx`
- Create: `scripts/video-editing-production-preflight.test.mjs`
- Modify: `package.json`
- Modify: `docs/operations/video-editing-poc-gate.md`

**Interfaces:**
- Produces: `pnpm test:video-editing-preflight`.
- Consumes: all previous tasks.

- [ ] **Step 1: Add the production preflight test**

The test fails production enablement unless all of these are true: a non-empty commercial CE.SDK license is supplied, explicit licensed hostnames include production/staging, `VIDEO_EDITING_ENABLED=true`, allowlist is non-empty for canary, schema 0049 is applied, and health is green. It must never print the license or allowlist values.

- [ ] **Step 2: Add a deterministic authenticated QA fixture**

The QA page must demonstrate the eight spec acceptance cases with owned sample artifacts: trim; two-clip reorder; caption plus 9:16 export; one quoted scene regeneration; source preservation and restore; authenticated output download; foreign/expired quote rejection; and visible cost/render/undo evidence. It must not contain production credentials, user data, or a bypass route.

- [ ] **Step 3: Run the full verification matrix**

Run serially to keep memory below the user's ~10GB ceiling:

```bash
pnpm --filter @holaday/orchestrator test
pnpm --filter @holaday/web-workbench test
pnpm --filter @holaday/orchestrator typecheck
pnpm --filter @holaday/web-workbench typecheck
pnpm --filter @holaday/orchestrator lint
pnpm --filter @holaday/web-workbench lint
pnpm --filter @holaday/web-workbench build
pnpm test:video-editing-preflight
git diff --check
```

Expected: every command passes; the preflight intentionally reports `production_disabled_pending_commercial_license` until the contract/license fields are supplied.

- [ ] **Step 4: Browser-verify the full POC at fixed viewports**

Use the user-selected in-app browser. Verify 1440×900 and 390×844 states for entry, project loading, scene selection, AI plan preview, free apply, paid quote CTA, export, version restore, insufficient balance, SDK fallback, expired media, and keyboard focus. Capture same-state screenshots before/after and compare them together; fix cropping, density, typography, radius, spacing, and focus defects before release.

- [ ] **Step 5: Commit and release only the safe surface**

Commit: `test(video-editing): close poc acceptance gates`

Push and create a PR after all tests pass. Merge/deploy the code with `VIDEO_EDITING_ENABLED=false` unless the commercial-license checklist and canary allowlist are explicitly approved. After deployment, verify both health endpoints and confirm `/video` remains unchanged for users outside the allowlist.

---

## Self-review record

- **Spec coverage:** Entries, embedded panel, generated/clone/IP/upload sources, compatible multi-clip import, AI plan preview, free vs quoted execution, immutable versions, restore, export/file delivery, ownership, scoped URLs, locked-subject preservation, trial/licensing gate, and all eight POC acceptance cases map to Tasks 1–9.
- **Deliberate POC limit:** Transcription/silence detection is represented by typed scene operations and source-import metadata; production-grade speech processing is not invented in the browser and must use an approved provider in a follow-up plan after this POC proves the editing loop.
- **Production truth boundary:** Evaluation-mode CE.SDK is permitted only for local/staging POC. Production remains disabled until the commercial license, hostname coverage, browser/codec matrix, and render terms are documented and the preflight passes.
- **Type consistency:** `VideoEditDocument`, `VideoEditOperation`, `VideoEditPlan`, project/version IDs, quote hash, and adapter signatures are defined once and consumed consistently by later tasks.
- **Placeholder scan:** The plan contains no TBD/TODO steps; each implementation task has explicit interfaces, tests, commands, expected results, and a commit boundary.
