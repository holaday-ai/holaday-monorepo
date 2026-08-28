import { existsSync, readFileSync } from 'node:fs';
import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';
import {
  videoEditActionQuotes,
  videoEditProjects,
  videoEditRenderAttempts,
  videoEditVersions,
} from './video-editing.js';

function indexNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).indexes.map((index) => index.config.name);
}

describe('video editing schema', () => {
  it('stores one user-owned project with an explicit current version', () => {
    expect(Object.keys(getTableColumns(videoEditProjects))).toEqual([
      'id',
      'externalId',
      'userId',
      'sourceTaskId',
      'sourceFileId',
      'sourceKind',
      'provider',
      'status',
      'currentVersionId',
      'createdAt',
      'updatedAt',
    ]);
    expect(indexNames(videoEditProjects)).toEqual(
      expect.arrayContaining([
        'uk_video_edit_projects_external_id',
        'ix_video_edit_projects_user_updated',
      ]),
    );
  });

  it('stores immutable project revisions and their output artifact', () => {
    expect(Object.keys(getTableColumns(videoEditVersions))).toEqual([
      'id',
      'externalId',
      'projectId',
      'parentVersionId',
      'revision',
      'documentJson',
      'operationJson',
      'sdkDocument',
      'outputFileId',
      'renderStatus',
      'createdAt',
    ]);
    expect(indexNames(videoEditVersions)).toEqual(
      expect.arrayContaining([
        'uk_video_edit_versions_external_id',
        'uk_video_edit_versions_project_revision',
        'ix_video_edit_versions_project_created',
      ]),
    );
  });

  it('binds a one-use action quote to user, project, version, and operation hash', () => {
    expect(Object.keys(getTableColumns(videoEditActionQuotes))).toEqual([
      'id',
      'externalId',
      'userId',
      'projectId',
      'baseVersionId',
      'operationHash',
      'operationJson',
      'costUnits',
      'status',
      'expiresAt',
      'consumedAt',
      'createdAt',
    ]);
    expect(indexNames(videoEditActionQuotes)).toEqual(
      expect.arrayContaining([
        'uk_video_edit_action_quotes_external_id',
        'ix_video_edit_action_quotes_user_status_expiry',
      ]),
    );
  });

  it('binds each client export attempt to one owned project version and output file', () => {
    expect(Object.keys(getTableColumns(videoEditRenderAttempts))).toEqual([
      'id',
      'externalId',
      'userId',
      'projectId',
      'versionId',
      'outputFileId',
      'status',
      'expiresAt',
      'completedAt',
      'createdAt',
    ]);
    expect(indexNames(videoEditRenderAttempts)).toEqual(
      expect.arrayContaining([
        'uk_video_edit_render_attempts_external_id',
        'ix_video_edit_render_attempts_user_status_expiry',
      ]),
    );
  });

  it('ships one additive numbered migration with ownership and version constraints', () => {
    const migrationUrl = new URL(
      '../../../drizzle/0053_video_editing_projects.sql',
      import.meta.url,
    );
    expect(existsSync(migrationUrl)).toBe(true);
    if (!existsSync(migrationUrl)) return;

    const migration = readFileSync(migrationUrl, 'utf8');
    expect(migration.match(/\bCREATE TABLE\b/g)).toHaveLength(3);
    expect(migration).toContain('UNIQUE KEY `uk_video_edit_versions_project_revision`');
    expect(migration).toContain('KEY `ix_video_edit_projects_user_updated`');
    expect(migration).toContain('KEY `ix_video_edit_action_quotes_user_status_expiry`');
    expect(migration.match(/ON DELETE CASCADE/g)?.length).toBeGreaterThanOrEqual(3);
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE|RENAME)\b/i);
    expect(migration).not.toMatch(/^\s*(?:DELETE|UPDATE)\b/im);
  });

  it('requires all editing tables and ownership columns at release time', () => {
    const verifier = readFileSync(
      new URL('../../../scripts/verify-db-schema.ts', import.meta.url),
      'utf8',
    );
    expect(verifier).toContain("'video_edit_projects'");
    expect(verifier).toContain("'video_edit_versions'");
    expect(verifier).toContain("'video_edit_action_quotes'");
    expect(verifier).toContain("'video_edit_render_attempts'");
    expect(verifier).toMatch(/video_edit_projects:\s*\[[\s\S]*?'current_version_id',?\s*\]/);
    expect(verifier).toContain(
      "video_edit_versions: ['external_id', 'project_id', 'revision', 'document_json', 'render_status']",
    );
    expect(verifier).toMatch(/video_edit_action_quotes:\s*\[[\s\S]*?'expires_at',?\s*\]/);
    expect(verifier).toMatch(/video_edit_render_attempts:\s*\[[\s\S]*?'expires_at',?\s*\]/);
  });
});
