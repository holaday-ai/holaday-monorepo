/** Rows already restricted by authenticated owner, task, output kind and active expiry. */
export interface ScopedSavedTaskFile {
  externalId: string;
  filename: string;
  mimetype: string;
  sizeBytes: number;
  expiresAt: Date | null;
}

function recoverSavedAttachments(
  result: unknown,
  availableFileIds: ReadonlySet<string>,
  rows: readonly ScopedSavedTaskFile[],
  now: Date,
): unknown {
  const saved = rows.filter(
    (row) =>
      availableFileIds.has(row.externalId) &&
      /^[A-Za-z0-9_-]{1,160}$/.test(row.externalId) &&
      typeof row.filename === 'string' &&
      row.filename.length > 0 &&
      typeof row.mimetype === 'string' &&
      row.mimetype.length > 0 &&
      Number.isSafeInteger(row.sizeBytes) &&
      row.sizeBytes >= 0 &&
      (row.expiresAt === null ||
        (row.expiresAt instanceof Date && row.expiresAt.getTime() > now.getTime())),
  );
  if (!saved.length || (result != null && (typeof result !== 'object' || Array.isArray(result))))
    return result;
  const record = (result ?? {}) as Record<string, unknown>;
  const rawMetadata = record.metadata;
  const metadata =
    rawMetadata && typeof rawMetadata === 'object' && !Array.isArray(rawMetadata)
      ? (rawMetadata as Record<string, unknown>)
      : {};
  const attachments = new Map<string, Record<string, unknown>>();
  const malformed: unknown[] = [];
  for (const attachment of Array.isArray(metadata.attachments) ? metadata.attachments : []) {
    if (
      attachment &&
      typeof attachment === 'object' &&
      !Array.isArray(attachment) &&
      typeof attachment.fileId === 'string'
    ) {
      if (!attachments.has(attachment.fileId)) attachments.set(attachment.fileId, attachment);
    } else malformed.push(attachment);
  }
  for (const row of saved) {
    const prior = attachments.get(row.externalId);
    attachments.set(row.externalId, {
      ...prior,
      fileId: row.externalId,
      filename: row.filename,
      mimetype: row.mimetype,
      sizeBytes: row.sizeBytes,
      downloadUrl: `/api/files/${row.externalId}/download`,
      kind:
        prior?.kind === 'screenshot' && row.mimetype.startsWith('image/')
          ? 'screenshot'
          : (row.filename.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? 'file'),
      // A legacy non-expiring row has no deadline to invent. The existing
      // card treats an empty deadline as unknown and checks access on download.
      expiresAt: row.expiresAt?.toISOString() ?? '',
      availability: 'available',
    });
  }
  return {
    ...record,
    metadata: { ...metadata, attachments: [...attachments.values(), ...malformed] },
  };
}

export function annotateTaskResultAttachmentAvailability(
  result: unknown,
  availableFileIds: ReadonlySet<string>,
  now = new Date(),
  savedRows: readonly ScopedSavedTaskFile[] = [],
): unknown {
  const recovered = recoverSavedAttachments(result, availableFileIds, savedRows, now);
  if (!recovered || typeof recovered !== 'object' || Array.isArray(recovered)) {
    return recovered;
  }
  const record = recovered as Record<string, unknown>;
  const metadata = record.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return recovered;
  }
  const metadataRecord = metadata as Record<string, unknown>;
  const attachments = metadataRecord.attachments;
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return recovered;
  }

  let changed = false;
  const annotated = attachments.map((attachment) => {
    if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) {
      return attachment;
    }
    const attachmentRecord = attachment as Record<string, unknown>;
    const fileId = attachmentRecord.fileId;
    let nextAttachment = attachmentRecord;

    if (typeof fileId === 'string' && !availableFileIds.has(fileId)) {
      const expiresAt = attachmentRecord.expiresAt;
      const expiry = typeof expiresAt === 'string' ? Date.parse(expiresAt) : Number.NaN;
      if (!Number.isFinite(expiry) || expiry > now.getTime()) {
        nextAttachment = {
          ...nextAttachment,
          availability: 'unavailable',
        };
      }
    }

    const posterFileId = localFileIdFromDownloadUrl(attachmentRecord.posterUrl);
    if (posterFileId && !availableFileIds.has(posterFileId)) {
      nextAttachment = {
        ...nextAttachment,
        posterAvailability: 'unavailable',
      };
    }

    if (nextAttachment !== attachmentRecord) changed = true;
    return nextAttachment;
  });

  if (!changed) return recovered;
  return {
    ...record,
    metadata: {
      ...metadataRecord,
      attachments: annotated,
    },
  };
}

function localFileIdFromDownloadUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return null;
  }
  try {
    const url = new URL(value, 'https://holaday.local');
    if (url.origin !== 'https://holaday.local') return null;
    const match = /^\/(?:api\/)?files\/([^/]+)\/download\/?$/.exec(url.pathname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
