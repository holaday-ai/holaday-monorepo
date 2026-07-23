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
    if (typeof fileId !== 'string' || availableFileIds.has(fileId)) {
      return attachment;
    }
    const expiresAt = attachmentRecord.expiresAt;
    if (typeof expiresAt === 'string') {
      const expiry = Date.parse(expiresAt);
      if (Number.isFinite(expiry) && expiry <= now.getTime()) {
        return attachment;
      }
    }
    changed = true;
    return { ...attachmentRecord, availability: 'unavailable' };
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
