export type ImageGenerationMode = 'free' | 'lock_subject';

/**
 * The image model treats its first input as the identity anchor. Keep that
 * ordering server-authoritative instead of trusting the browser array order.
 */
export function orderImageAttachmentIds(
  fileIds: readonly string[],
  mode: ImageGenerationMode | undefined,
  subjectFileId: string | undefined,
): string[] {
  if (mode !== 'lock_subject') return [...fileIds];
  const uniqueFileIds = fileIds.filter((fileId, index) => fileIds.indexOf(fileId) === index);
  if (!subjectFileId) {
    throw new Error('请选择一张主角图');
  }
  if (!uniqueFileIds.includes(subjectFileId)) {
    throw new Error('主角图不在本次任务附件中');
  }
  return [subjectFileId, ...uniqueFileIds.filter((fileId) => fileId !== subjectFileId)];
}
