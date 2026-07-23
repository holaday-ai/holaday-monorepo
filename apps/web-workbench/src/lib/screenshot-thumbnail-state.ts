export type ScreenshotThumbnailPresentation = 'thumbnail' | 'file-card';

export function screenshotThumbnailPresentation(options: {
  previewFailed: boolean;
  fileUnavailable: boolean;
}): ScreenshotThumbnailPresentation {
  return options.previewFailed || options.fileUnavailable
    ? 'file-card'
    : 'thumbnail';
}
