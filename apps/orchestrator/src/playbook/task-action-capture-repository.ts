import { newExternalId } from '@holaday/shared-types';
import type { DB } from '../db/client.js';
import { readInsertId } from '../db/mysql-result.js';
import {
  type NewTaskActionCapture,
  type TaskActionCapture,
  taskActionCaptures,
} from '../db/schema/task-action-captures.js';

/**
 * Phase 1 Playbook B2 — `TaskActionCaptureRepository`.
 *
 * Single write touch-point for `task_action_captures` (the RAW per-action
 * capture trajectory; distillation source for ① crystallization). Mirrors
 * `EvidenceArtifactRepository`.
 *
 * Redaction of `inputValue` is the CALLER's responsibility and happens in
 * the supercar agent-loop BEFORE the value reaches this repo (see
 * `action-capture-redaction.ts`) — this repo persists exactly what it's
 * given. `capturedAt` is left to the DB default (CURRENT_TIMESTAMP(3)).
 */
export interface CreateActionCaptureInput {
  taskId: number;
  siteDomain?: string | null;
  actionIndex: number;
  stepType: string;
  visibleText?: string | null;
  targetSelectorJson?: unknown;
  coordinateJson?: unknown;
  framePath?: string | null;
  entryUrl?: string | null;
  inputValue?: string | null;
  screenshotAnchorId?: number | null;
}

export class TaskActionCaptureRepository {
  constructor(private readonly db: DB) {}

  async create(input: CreateActionCaptureInput): Promise<TaskActionCapture> {
    const externalId = newExternalId('taskActionCapture');
    const values: NewTaskActionCapture = {
      externalId,
      taskId: input.taskId,
      siteDomain: input.siteDomain ?? null,
      actionIndex: input.actionIndex,
      stepType: input.stepType,
      visibleText: input.visibleText ?? null,
      ...(input.targetSelectorJson !== undefined
        ? { targetSelectorJson: input.targetSelectorJson }
        : {}),
      ...(input.coordinateJson !== undefined ? { coordinateJson: input.coordinateJson } : {}),
      framePath: input.framePath ?? null,
      entryUrl: input.entryUrl ?? null,
      inputValue: input.inputValue ?? null,
      screenshotAnchorId: input.screenshotAnchorId ?? null,
    };
    const insert = await this.db.insert(taskActionCaptures).values(values);
    return { ...(values as TaskActionCapture), id: readInsertId(insert) };
  }
}
