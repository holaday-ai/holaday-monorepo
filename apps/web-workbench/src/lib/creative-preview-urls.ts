interface CreativePreview {
  previewDataUrl?: string;
}

export function revokeCreativePreviewUrls(
  previews: readonly CreativePreview[],
  revokeObjectURL: (url: string) => void = (url) => URL.revokeObjectURL(url),
): void {
  const urls = new Set(
    previews
      .map((preview) => preview.previewDataUrl)
      .filter((url): url is string => typeof url === 'string' && url.startsWith('blob:')),
  );

  for (const url of urls) revokeObjectURL(url);
}
