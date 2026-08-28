export interface VideoEditorMountInput {
  container: HTMLElement;
  license: string | null;
  sceneDocument: string | null;
  sourceUrl: string;
  locale: 'zh-CN';
  onDocumentChanged(document: string): void;
}

export interface MountedVideoEditor {
  exportMp4(): Promise<Blob>;
  serialize(): Promise<string>;
  destroy(): Promise<void>;
}

export interface VideoEditorAdapter {
  mount(input: VideoEditorMountInput): Promise<MountedVideoEditor>;
}

/**
 * React strict mode and route transitions may request cleanup twice. Keep the
 * vendor lifecycle idempotent without weakening export/serialization typing.
 */
export function createIdempotentMountedVideoEditor(
  delegate: MountedVideoEditor,
): MountedVideoEditor {
  let destroyPromise: Promise<void> | null = null;

  return {
    exportMp4: () => delegate.exportMp4(),
    serialize: () => delegate.serialize(),
    destroy: () => {
      destroyPromise ??= delegate.destroy();
      return destroyPromise;
    },
  };
}
