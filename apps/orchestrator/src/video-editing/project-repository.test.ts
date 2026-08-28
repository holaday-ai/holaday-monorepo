import { describe, expect, it } from 'vitest';
import {
  type VideoEditActionQuoteRecord,
  VideoEditProjectRepository,
  type VideoEditProjectStore,
  type VideoEditRepositoryError,
} from './project-repository.js';
import type {
  VideoEditDocument,
  VideoEditOperation,
  VideoEditProjectRecord,
  VideoEditVersionRecord,
} from './types.js';

const BASE_DOCUMENT: VideoEditDocument = {
  aspectRatio: '16:9',
  scenes: [
    {
      id: 'scene_1',
      sourceFileId: 'file_source',
      sourceStartMs: 0,
      sourceEndMs: 4_000,
      order: 0,
      caption: '',
      audioGain: 1,
      generationContext: null,
    },
  ],
};

type StoredProject = VideoEditProjectRecord & {
  sourceTaskId: number | null;
  sourceFileId: number | null;
  createdAt: Date;
  updatedAt: Date;
};

class MemoryVideoEditProjectStore implements VideoEditProjectStore {
  readonly projects: StoredProject[] = [];
  readonly versions: VideoEditVersionRecord[] = [];
  readonly quotes: VideoEditActionQuoteRecord[] = [];
  transactions = 0;
  lockedProjectIds: number[] = [];
  lockedQuoteIds: number[] = [];
  private nextProjectId = 1;
  private nextVersionId = 1;
  private nextQuoteId = 1;

  async transaction<T>(callback: (store: VideoEditProjectStore) => Promise<T>): Promise<T> {
    this.transactions += 1;
    return callback(this);
  }

  async findOwnedProject(externalId: string, userId: number, lock = false) {
    const project =
      this.projects.find(
        (candidate) => candidate.externalId === externalId && candidate.userId === userId,
      ) ?? null;
    if (project && lock) this.lockedProjectIds.push(project.id);
    return project;
  }

  async findVersionById(projectId: number, versionId: number) {
    return (
      this.versions.find(
        (candidate) => candidate.projectId === projectId && candidate.id === versionId,
      ) ?? null
    );
  }

  async findVersionByExternalId(projectId: number, externalId: string) {
    return (
      this.versions.find(
        (candidate) => candidate.projectId === projectId && candidate.externalId === externalId,
      ) ?? null
    );
  }

  async listVersions(projectId: number) {
    return this.versions
      .filter((candidate) => candidate.projectId === projectId)
      .sort((left, right) => right.revision - left.revision);
  }

  async insertProject(input: Omit<StoredProject, 'id'>) {
    const project = { id: this.nextProjectId++, ...structuredClone(input) };
    this.projects.push(project);
    return project;
  }

  async insertVersion(input: Omit<VideoEditVersionRecord, 'id'>) {
    const version = { id: this.nextVersionId++, ...structuredClone(input) };
    this.versions.push(version);
    return version;
  }

  async updateProjectCurrentVersion(projectId: number, currentVersionId: number, updatedAt: Date) {
    const project = this.projects.find((candidate) => candidate.id === projectId);
    if (!project) return false;
    project.currentVersionId = currentVersionId;
    project.updatedAt = updatedAt;
    return true;
  }

  async insertQuote(input: Omit<VideoEditActionQuoteRecord, 'id' | 'createdAt'>) {
    const quote = {
      id: this.nextQuoteId++,
      ...structuredClone(input),
      createdAt: new Date('2026-08-28T00:00:00Z'),
    };
    this.quotes.push(quote);
    return quote;
  }

  async findQuote(externalId: string, userId: number, projectId: number, lock = false) {
    const quote =
      this.quotes.find(
        (candidate) =>
          candidate.externalId === externalId &&
          candidate.userId === userId &&
          candidate.projectId === projectId,
      ) ?? null;
    if (quote && lock) this.lockedQuoteIds.push(quote.id);
    return quote;
  }

  async markQuoteConsumed(quoteId: number, consumedAt: Date) {
    const quote = this.quotes.find((candidate) => candidate.id === quoteId);
    if (!quote || quote.status !== 'pending') return false;
    quote.status = 'consumed';
    quote.consumedAt = consumedAt;
    return true;
  }
}

function repositoryFixture() {
  const store = new MemoryVideoEditProjectStore();
  const repository = new VideoEditProjectRepository(store);
  return { repository, store };
}

async function createProject(
  repository: VideoEditProjectRepository,
  overrides: Partial<Parameters<VideoEditProjectRepository['createFromSource']>[0]> = {},
) {
  return repository.createFromSource({
    userId: 7,
    sourceTaskId: 21,
    sourceFileId: 31,
    sourceKind: 'generated',
    document: BASE_DOCUMENT,
    now: new Date('2026-08-28T00:00:00Z'),
    ...overrides,
  });
}

describe('video editing project repository', () => {
  it('lists owned immutable versions newest first without exposing another project', async () => {
    const { repository } = repositoryFixture();
    const created = await createProject(repository);
    await repository.appendVersion({
      userId: 7,
      projectId: created.project.externalId,
      baseVersionId: created.currentVersion.externalId,
      document: BASE_DOCUMENT,
      operations: [],
    });

    await expect(repository.listVersions(created.project.externalId, 7)).resolves.toMatchObject([
      { revision: 2 },
      { revision: 1 },
    ]);
    await expect(repository.listVersions(created.project.externalId, 8)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    } satisfies Partial<VideoEditRepositoryError>);
  });

  it('loads only a project owned by the requesting user', async () => {
    const { repository } = repositoryFixture();
    const created = await createProject(repository);

    await expect(repository.getOwnedProject(created.project.externalId, 7)).resolves.toMatchObject({
      project: { externalId: created.project.externalId, userId: 7 },
      currentVersion: { externalId: created.currentVersion.externalId, revision: 1 },
    });
    await expect(repository.getOwnedProject(created.project.externalId, 8)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    } satisfies Partial<VideoEditRepositoryError>);
  });

  it('appends an immutable child revision under a project-row transaction lock', async () => {
    const { repository, store } = repositoryFixture();
    const created = await createProject(repository);
    const originalSnapshot = structuredClone(store.versions[0]);
    const operations: VideoEditOperation[] = [
      { kind: 'caption', sceneId: 'scene_1', text: '新的开场' },
    ];
    const nextDocument = structuredClone(BASE_DOCUMENT);
    const firstScene = nextDocument.scenes[0];
    if (!firstScene) throw new Error('fixture scene is missing');
    firstScene.caption = '新的开场';

    const next = await repository.appendVersion({
      userId: 7,
      projectId: created.project.externalId,
      baseVersionId: created.currentVersion.externalId,
      document: nextDocument,
      operations,
      sdkDocument: '{"scene":"next"}',
      now: new Date('2026-08-28T00:05:00Z'),
    });

    expect(next).toMatchObject({
      revision: 2,
      parentVersionId: created.currentVersion.id,
      documentJson: nextDocument,
      operationJson: operations,
    });
    expect(store.versions).toHaveLength(2);
    expect(store.versions[0]).toEqual(originalSnapshot);
    expect(store.projects[0]?.currentVersionId).toBe(next.id);
    expect(store.transactions).toBe(2);
    expect(store.lockedProjectIds).toEqual([created.project.id]);
  });

  it('rejects an append when another writer already advanced the base version', async () => {
    const { repository } = repositoryFixture();
    const created = await createProject(repository);
    const first = await repository.appendVersion({
      userId: 7,
      projectId: created.project.externalId,
      baseVersionId: created.currentVersion.externalId,
      document: BASE_DOCUMENT,
      operations: [],
    });

    await expect(
      repository.appendVersion({
        userId: 7,
        projectId: created.project.externalId,
        baseVersionId: created.currentVersion.externalId,
        document: BASE_DOCUMENT,
        operations: [],
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(first.revision).toBe(2);
  });

  it('restores by creating a child of the current version instead of rewinding the pointer', async () => {
    const { repository, store } = repositoryFixture();
    const created = await createProject(repository);
    const changedDocument = structuredClone(BASE_DOCUMENT);
    changedDocument.aspectRatio = '9:16';
    const second = await repository.appendVersion({
      userId: 7,
      projectId: created.project.externalId,
      baseVersionId: created.currentVersion.externalId,
      document: changedDocument,
      operations: [{ kind: 'aspect_ratio', value: '9:16' }],
    });

    const restored = await repository.restoreVersion({
      userId: 7,
      projectId: created.project.externalId,
      baseVersionId: second.externalId,
      targetVersionId: created.currentVersion.externalId,
    });

    expect(restored).toMatchObject({
      revision: 3,
      parentVersionId: second.id,
      documentJson: BASE_DOCUMENT,
      outputFileId: null,
      renderStatus: 'idle',
    });
    expect(restored.id).not.toBe(created.currentVersion.id);
    expect(store.projects[0]?.currentVersionId).toBe(restored.id);
    expect(store.versions.map((version) => version.revision)).toEqual([1, 2, 3]);
  });

  it('consumes an exact unexpired quote once and rejects replay or changed bindings', async () => {
    const { repository, store } = repositoryFixture();
    const created = await createProject(repository);
    const operations: VideoEditOperation[] = [
      { kind: 'regenerate_scene', sceneId: 'scene_1', prompt: '换成清晨光线' },
    ];
    const quote = await repository.createQuote({
      userId: 7,
      projectId: created.project.externalId,
      baseVersionId: created.currentVersion.externalId,
      operationHash: 'a'.repeat(64),
      operations,
      costUnits: 12,
      expiresAt: new Date('2026-08-28T00:10:00Z'),
    });

    await expect(
      repository.consumeQuote({
        userId: 7,
        projectId: created.project.externalId,
        baseVersionId: created.currentVersion.externalId,
        quoteId: quote.externalId,
        operationHash: 'b'.repeat(64),
        now: new Date('2026-08-28T00:05:00Z'),
      }),
    ).resolves.toEqual({ status: 'mismatch' });
    expect(store.quotes[0]?.status).toBe('pending');

    await expect(
      repository.consumeQuote({
        userId: 7,
        projectId: created.project.externalId,
        baseVersionId: created.currentVersion.externalId,
        quoteId: quote.externalId,
        operationHash: 'a'.repeat(64),
        now: new Date('2026-08-28T00:05:00Z'),
      }),
    ).resolves.toMatchObject({ status: 'consumed', quote: { costUnits: 12 } });
    await expect(
      repository.consumeQuote({
        userId: 7,
        projectId: created.project.externalId,
        baseVersionId: created.currentVersion.externalId,
        quoteId: quote.externalId,
        operationHash: 'a'.repeat(64),
        now: new Date('2026-08-28T00:06:00Z'),
      }),
    ).resolves.toEqual({ status: 'already_consumed' });
    expect(store.lockedQuoteIds).toEqual([quote.id, quote.id, quote.id]);
  });

  it('does not consume foreign, expired, or stale-base quotes', async () => {
    const { repository, store } = repositoryFixture();
    const created = await createProject(repository);
    const operations: VideoEditOperation[] = [
      { kind: 'regenerate_scene', sceneId: 'scene_1', prompt: '换成清晨光线' },
    ];
    const quote = await repository.createQuote({
      userId: 7,
      projectId: created.project.externalId,
      baseVersionId: created.currentVersion.externalId,
      operationHash: 'a'.repeat(64),
      operations,
      costUnits: 12,
      expiresAt: new Date('2026-08-28T00:10:00Z'),
    });

    await expect(
      repository.consumeQuote({
        userId: 8,
        projectId: created.project.externalId,
        baseVersionId: created.currentVersion.externalId,
        quoteId: quote.externalId,
        operationHash: 'a'.repeat(64),
        now: new Date('2026-08-28T00:05:00Z'),
      }),
    ).resolves.toEqual({ status: 'not_found' });
    await expect(
      repository.consumeQuote({
        userId: 7,
        projectId: created.project.externalId,
        baseVersionId: created.currentVersion.externalId,
        quoteId: quote.externalId,
        operationHash: 'a'.repeat(64),
        now: new Date('2026-08-28T00:11:00Z'),
      }),
    ).resolves.toEqual({ status: 'expired' });

    const advanced = await repository.appendVersion({
      userId: 7,
      projectId: created.project.externalId,
      baseVersionId: created.currentVersion.externalId,
      document: BASE_DOCUMENT,
      operations: [],
    });
    expect(advanced.revision).toBe(2);
    await expect(
      repository.consumeQuote({
        userId: 7,
        projectId: created.project.externalId,
        baseVersionId: created.currentVersion.externalId,
        quoteId: quote.externalId,
        operationHash: 'a'.repeat(64),
        now: new Date('2026-08-28T00:05:00Z'),
      }),
    ).resolves.toEqual({ status: 'stale_base' });
    expect(store.quotes[0]?.status).toBe('pending');
  });
});
