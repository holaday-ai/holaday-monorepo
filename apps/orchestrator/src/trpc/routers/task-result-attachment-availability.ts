export function annotateTaskResultAttachmentAvailability(
  result: unknown,
  availableFileIds: ReadonlySet<string>,
  now = new Date(),
): unknown {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return result;
  }
  const record = result as Record<string, unknown>;
  const metadata = record.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return result;
  }
  const metadataRecord = metadata as Record<string, unknown>;
  const attachments = metadataRecord.attachments;
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return result;
  }

  let changed = false;
  const annotated = attachments.map((attachment) => {
    if (
      !attachment ||
      typeof attachment !== 'object' ||
      Array.isArray(attachment)
    ) {
      return attachment;
    }
    const attachmentRecord = attachment as Record<string, unknown>;
    const fileId = attachmentRecord.fileId;
    let nextAttachment = attachmentRecord;

    if (typeof fileId === 'string' && !availableFileIds.has(fileId)) {
      const expiresAt = attachmentRecord.expiresAt;
      const expiry =
        typeof expiresAt === 'string' ? Date.parse(expiresAt) : Number.NaN;
      if (!Number.isFinite(expiry) || expiry > now.getTime()) {
        nextAttachment = {
          ...nextAttachment,
          availability: 'unavailable',
        };
      }
    }

    const posterFileId = localFileIdFromDownloadUrl(
      attachmentRecord.posterUrl,
    );
    if (posterFileId && !availableFileIds.has(posterFileId)) {
      nextAttachment = {
        ...nextAttachment,
        posterAvailability: 'unavailable',
      };
    }

    if (nextAttachment !== attachmentRecord) changed = true;
    return nextAttachment;
  });

  if (!changed) return result;
  return {
    ...record,
    metadata: {
      ...metadataRecord,
      attachments: annotated,
    },
  };
}

function localFileIdFromDownloadUrl(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//')
  ) {
    return null;
  }
  try {
    const url = new URL(value, 'https://holaday.local');
    if (url.origin !== 'https://holaday.local') return null;
    const match = /^\/(?:api\/)?files\/([^/]+)\/download\/?$/.exec(
      url.pathname,
    );
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
