import { newExternalId } from '@holaday/shared-types';
import { and, eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { readAffectedRows, readInsertId } from '../db/mysql-result.js';
import {
  videoEditActionQuotes,
  videoEditProjects,
  videoEditVersions,
} from '../db/schema/video-editing.js';
import type {
  VideoEditDocument,
  VideoEditOperation,
  VideoEditProjectRecord,
  VideoEditSourceKind,
  VideoEditVersionRecord,
} from './types.js';

export type VideoEditRepositoryErrorCode = 'NOT_FOUND' | 'CONFLICT';

export class VideoEditRepositoryError extends Error {
  constructor(
    public readonly code: VideoEditRepositoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'VideoEditRepositoryError';
  }
}

export interface StoredVideoEditProject extends VideoEditProjectRecord {
  sourceTaskId: number | null;
  sourceFileId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface VideoEditActionQuoteRecord {
  id: number;
  externalId: string;
  userId: number;
  projectId: number;
  baseVersionId: number;
  operationHash: string;
  operationJson: VideoEditOperation[];
  costUnits: number;
  status: 'pending' | 'consumed';
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

export interface VideoEditProjectStore {
  transaction<T>(callback: (store: VideoEditProjectStore) => Promise<T>): Promise<T>;
  findOwnedProject(
    externalId: string,
    userId: number,
    lock?: boolean,
  ): Promise<StoredVideoEditProject | null>;
  findVersionById(projectId: number, versionId: number): Promise<VideoEditVersionRecord | null>;
  findVersionByExternalId(
    projectId: number,
    externalId: string,
  ): Promise<VideoEditVersionRecord | null>;
  insertProject(input: Omit<StoredVideoEditProject, 'id'>): Promise<StoredVideoEditProject>;
  insertVersion(input: Omit<VideoEditVersionRecord, 'id'>): Promise<VideoEditVersionRecord>;
  updateProjectCurrentVersion(
    projectId: number,
    currentVersionId: number,
    updatedAt: Date,
  ): Promise<boolean>;
  insertQuote(
    input: Omit<VideoEditActionQuoteRecord, 'id' | 'createdAt'>,
  ): Promise<VideoEditActionQuoteRecord>;
  findQuote(
    externalId: string,
    userId: number,
    projectId: number,
    lock?: boolean,
  ): Promise<VideoEditActionQuoteRecord | null>;
  markQuoteConsumed(quoteId: number, consumedAt: Date): Promise<boolean>;
}

type DBTransaction = Parameters<Parameters<DB['transaction']>[0]>[0];

function asProjectRecord(row: typeof videoEditProjects.$inferSelect): StoredVideoEditProject {
  return {
    ...row,
    sourceKind: row.sourceKind as VideoEditProjectRecord['sourceKind'],
    provider: row.provider as VideoEditProjectRecord['provider'],
    status: row.status as VideoEditProjectRecord['status'],
  };
}

function asVersionRecord(row: typeof videoEditVersions.$inferSelect): VideoEditVersionRecord {
  return {
    ...row,
    documentJson: row.documentJson as VideoEditDocument,
    operationJson: row.operationJson as VideoEditOperation[] | null,
    renderStatus: row.renderStatus as VideoEditVersionRecord['renderStatus'],
  };
}

function asQuoteRecord(row: typeof videoEditActionQuotes.$inferSelect): VideoEditActionQuoteRecord {
  return {
    ...row,
    operationJson: row.operationJson as VideoEditOperation[],
    status: row.status as VideoEditActionQuoteRecord['status'],
  };
}

class DrizzleVideoEditProjectStore implements VideoEditProjectStore {
  constructor(private readonly db: DB | DBTransaction) {}

  async transaction<T>(callback: (store: VideoEditProjectStore) => Promise<T>): Promise<T> {
    if (!('transaction' in this.db)) return callback(this);
    return this.db.transaction(async (transaction) => {
      return callback(new DrizzleVideoEditProjectStore(transaction));
    });
  }

  async findOwnedProject(externalId: string, userId: number, lock = false) {
    const query = this.db
      .select()
      .from(videoEditProjects)
      .where(
        and(eq(videoEditProjects.externalId, externalId), eq(videoEditProjects.userId, userId)),
      )
      .limit(1);
    const rows = lock ? await query.for('update') : await query;
    return rows[0] ? asProjectRecord(rows[0]) : null;
  }

  async findVersionById(projectId: number, versionId: number) {
    const [row] = await this.db
      .select()
      .from(videoEditVersions)
      .where(and(eq(videoEditVersions.projectId, projectId), eq(videoEditVersions.id, versionId)))
      .limit(1);
    return row ? asVersionRecord(row) : null;
  }

  async findVersionByExternalId(projectId: number, externalId: string) {
    const [row] = await this.db
      .select()
      .from(videoEditVersions)
      .where(
        and(
          eq(videoEditVersions.projectId, projectId),
          eq(videoEditVersions.externalId, externalId),
        ),
      )
      .limit(1);
    return row ? asVersionRecord(row) : null;
  }

  async insertProject(input: Omit<StoredVideoEditProject, 'id'>) {
    const result = await this.db.insert(videoEditProjects).values(input);
    return { id: readInsertId(result), ...input };
  }

  async insertVersion(input: Omit<VideoEditVersionRecord, 'id'>) {
    const result = await this.db.insert(videoEditVersions).values(input);
    return { id: readInsertId(result), ...input };
  }

  async updateProjectCurrentVersion(projectId: number, currentVersionId: number, updatedAt: Date) {
    const result = await this.db
      .update(videoEditProjects)
      .set({ currentVersionId, updatedAt })
      .where(eq(videoEditProjects.id, projectId));
    return readAffectedRows(result) === 1;
  }

  async insertQuote(input: Omit<VideoEditActionQuoteRecord, 'id' | 'createdAt'>) {
    const result = await this.db.insert(videoEditActionQuotes).values(input);
    return {
      id: readInsertId(result),
      ...input,
      createdAt: new Date(),
    };
  }

  async findQuote(externalId: string, userId: number, projectId: number, lock = false) {
    const query = this.db
      .select()
      .from(videoEditActionQuotes)
      .where(
        and(
          eq(videoEditActionQuotes.externalId, externalId),
          eq(videoEditActionQuotes.userId, userId),
          eq(videoEditActionQuotes.projectId, projectId),
        ),
      )
      .limit(1);
    const rows = lock ? await query.for('update') : await query;
    const [row] = rows;
    return row ? asQuoteRecord(row) : null;
  }

  async markQuoteConsumed(quoteId: number, consumedAt: Date) {
    const result = await this.db
      .update(videoEditActionQuotes)
      .set({ status: 'consumed', consumedAt })
      .where(
        and(eq(videoEditActionQuotes.id, quoteId), eq(videoEditActionQuotes.status, 'pending')),
      );
    return readAffectedRows(result) === 1;
  }
}

export function createVideoEditProjectStore(db: DB): VideoEditProjectStore {
  return new DrizzleVideoEditProjectStore(db);
}

export interface CreateVideoEditProjectInput {
  userId: number;
  sourceTaskId?: number | null;
  sourceFileId?: number | null;
  sourceKind: VideoEditSourceKind;
  document: VideoEditDocument;
  sdkDocument?: string | null;
  now?: Date;
}

export interface AppendVideoEditVersionInput {
  userId: number;
  projectId: string;
  baseVersionId: string;
  document: VideoEditDocument;
  operations: VideoEditOperation[] | null;
  sdkDocument?: string | null;
  outputFileId?: number | null;
  renderStatus?: VideoEditVersionRecord['renderStatus'];
  now?: Date;
}

export type ConsumeVideoEditQuoteResult =
  | { status: 'consumed'; quote: VideoEditActionQuoteRecord }
  | { status: 'not_found' | 'expired' | 'already_consumed' | 'mismatch' | 'stale_base' };

export type CheckVideoEditQuoteResult =
  | { status: 'valid'; quote: VideoEditActionQuoteRecord }
  | Exclude<ConsumeVideoEditQuoteResult, { status: 'consumed' }>;

export class VideoEditProjectRepository {
  constructor(private readonly store: VideoEditProjectStore) {}

  static fromDb(db: DB): VideoEditProjectRepository {
    return new VideoEditProjectRepository(createVideoEditProjectStore(db));
  }

  async createFromSource(input: CreateVideoEditProjectInput) {
    const now = input.now ?? new Date();
    return this.store.transaction(async (store) => {
      const project = await store.insertProject({
        externalId: newExternalId('videoEditProject'),
        userId: input.userId,
        sourceTaskId: input.sourceTaskId ?? null,
        sourceFileId: input.sourceFileId ?? null,
        sourceKind: input.sourceKind,
        provider: 'cesdk',
        status: 'active',
        currentVersionId: null,
        createdAt: now,
        updatedAt: now,
      });
      const currentVersion = await store.insertVersion({
        externalId: newExternalId('videoEditVersion'),
        projectId: project.id,
        parentVersionId: null,
        revision: 1,
        documentJson: structuredClone(input.document),
        operationJson: null,
        sdkDocument: input.sdkDocument ?? null,
        outputFileId: null,
        renderStatus: 'idle',
        createdAt: now,
      });
      if (!(await store.updateProjectCurrentVersion(project.id, currentVersion.id, now))) {
        throw new VideoEditRepositoryError('CONFLICT', '视频剪辑项目初始化失败');
      }
      return {
        project: { ...project, currentVersionId: currentVersion.id },
        currentVersion,
      };
    });
  }

  async getOwnedProject(projectId: string, userId: number) {
    const project = await this.requireOwnedProject(this.store, projectId, userId);
    const currentVersion =
      project.currentVersionId === null
        ? null
        : await this.store.findVersionById(project.id, project.currentVersionId);
    if (!currentVersion) {
      throw new VideoEditRepositoryError('NOT_FOUND', '视频剪辑项目不存在');
    }
    return { project, currentVersion };
  }

  async appendVersion(input: AppendVideoEditVersionInput): Promise<VideoEditVersionRecord> {
    return this.store.transaction((store) => this.appendVersionInTransaction(store, input));
  }

  async restoreVersion(input: {
    userId: number;
    projectId: string;
    baseVersionId: string;
    targetVersionId: string;
    now?: Date;
  }): Promise<VideoEditVersionRecord> {
    return this.store.transaction(async (store) => {
      const project = await this.requireOwnedProject(store, input.projectId, input.userId, true);
      const currentVersion = await this.requireCurrentVersion(store, project, input.baseVersionId);
      const targetVersion = await store.findVersionByExternalId(project.id, input.targetVersionId);
      if (!targetVersion) {
        throw new VideoEditRepositoryError('NOT_FOUND', '要恢复的视频版本不存在');
      }
      return this.insertChildVersion(store, project, currentVersion, {
        document: targetVersion.documentJson,
        operations: null,
        sdkDocument: targetVersion.sdkDocument,
        outputFileId: null,
        renderStatus: 'idle',
        now: input.now ?? new Date(),
      });
    });
  }

  async createQuote(input: {
    userId: number;
    projectId: string;
    baseVersionId: string;
    operationHash: string;
    operations: VideoEditOperation[];
    costUnits: number;
    expiresAt: Date;
  }): Promise<VideoEditActionQuoteRecord> {
    return this.store.transaction(async (store) => {
      const project = await this.requireOwnedProject(store, input.projectId, input.userId, true);
      const baseVersion = await this.requireCurrentVersion(store, project, input.baseVersionId);
      return store.insertQuote({
        externalId: newExternalId('videoEditQuote'),
        userId: input.userId,
        projectId: project.id,
        baseVersionId: baseVersion.id,
        operationHash: input.operationHash,
        operationJson: structuredClone(input.operations),
        costUnits: input.costUnits,
        status: 'pending',
        expiresAt: input.expiresAt,
        consumedAt: null,
      });
    });
  }

  async consumeQuote(input: {
    userId: number;
    projectId: string;
    baseVersionId: string;
    quoteId: string;
    operationHash: string;
    now?: Date;
  }): Promise<ConsumeVideoEditQuoteResult> {
    return this.store.transaction(async (store) => {
      const checked = await this.checkQuoteWithStore(store, input, true);
      if (checked.status !== 'valid') return checked;
      const consumedAt = input.now ?? new Date();
      if (!(await store.markQuoteConsumed(checked.quote.id, consumedAt))) {
        return { status: 'already_consumed' };
      }
      return {
        status: 'consumed',
        quote: { ...checked.quote, status: 'consumed', consumedAt },
      };
    });
  }

  async checkQuote(input: {
    userId: number;
    projectId: string;
    baseVersionId: string;
    quoteId: string;
    operationHash: string;
    now?: Date;
  }): Promise<CheckVideoEditQuoteResult> {
    return this.checkQuoteWithStore(this.store, input, false);
  }

  private async checkQuoteWithStore(
    store: VideoEditProjectStore,
    input: {
      userId: number;
      projectId: string;
      baseVersionId: string;
      quoteId: string;
      operationHash: string;
      now?: Date;
    },
    lock: boolean,
  ): Promise<CheckVideoEditQuoteResult> {
    const project = await store.findOwnedProject(input.projectId, input.userId, lock);
    if (!project) return { status: 'not_found' };
    const quote = await store.findQuote(input.quoteId, input.userId, project.id, lock);
    if (!quote) return { status: 'not_found' };
    if (quote.status !== 'pending') return { status: 'already_consumed' };
    if (quote.expiresAt.getTime() <= (input.now ?? new Date()).getTime()) {
      return { status: 'expired' };
    }
    const baseVersion = await store.findVersionByExternalId(project.id, input.baseVersionId);
    if (!baseVersion || quote.baseVersionId !== baseVersion.id) return { status: 'mismatch' };
    if (project.currentVersionId !== baseVersion.id) return { status: 'stale_base' };
    if (quote.operationHash !== input.operationHash) return { status: 'mismatch' };
    return { status: 'valid', quote };
  }

  private async appendVersionInTransaction(
    store: VideoEditProjectStore,
    input: AppendVideoEditVersionInput,
  ): Promise<VideoEditVersionRecord> {
    const project = await this.requireOwnedProject(store, input.projectId, input.userId, true);
    const currentVersion = await this.requireCurrentVersion(store, project, input.baseVersionId);
    return this.insertChildVersion(store, project, currentVersion, {
      document: input.document,
      operations: input.operations,
      sdkDocument: input.sdkDocument ?? null,
      outputFileId: input.outputFileId ?? null,
      renderStatus: input.renderStatus ?? 'idle',
      now: input.now ?? new Date(),
    });
  }

  private async insertChildVersion(
    store: VideoEditProjectStore,
    project: StoredVideoEditProject,
    currentVersion: VideoEditVersionRecord,
    input: {
      document: VideoEditDocument;
      operations: VideoEditOperation[] | null;
      sdkDocument: string | null;
      outputFileId: number | null;
      renderStatus: VideoEditVersionRecord['renderStatus'];
      now: Date;
    },
  ): Promise<VideoEditVersionRecord> {
    const version = await store.insertVersion({
      externalId: newExternalId('videoEditVersion'),
      projectId: project.id,
      parentVersionId: currentVersion.id,
      revision: currentVersion.revision + 1,
      documentJson: structuredClone(input.document),
      operationJson: input.operations === null ? null : structuredClone(input.operations),
      sdkDocument: input.sdkDocument,
      outputFileId: input.outputFileId,
      renderStatus: input.renderStatus,
      createdAt: input.now,
    });
    if (!(await store.updateProjectCurrentVersion(project.id, version.id, input.now))) {
      throw new VideoEditRepositoryError('CONFLICT', '视频版本刚刚发生变化，请刷新后重试');
    }
    return version;
  }

  private async requireOwnedProject(
    store: VideoEditProjectStore,
    projectId: string,
    userId: number,
    lock = false,
  ): Promise<StoredVideoEditProject> {
    const project = await store.findOwnedProject(projectId, userId, lock);
    if (!project) {
      throw new VideoEditRepositoryError('NOT_FOUND', '视频剪辑项目不存在');
    }
    return project;
  }

  private async requireCurrentVersion(
    store: VideoEditProjectStore,
    project: StoredVideoEditProject,
    baseVersionId: string,
  ): Promise<VideoEditVersionRecord> {
    const baseVersion = await store.findVersionByExternalId(project.id, baseVersionId);
    if (!baseVersion) {
      throw new VideoEditRepositoryError('NOT_FOUND', '视频版本不存在');
    }
    if (project.currentVersionId !== baseVersion.id) {
      throw new VideoEditRepositoryError('CONFLICT', '视频版本刚刚发生变化，请刷新后重试');
    }
    return baseVersion;
  }
}
