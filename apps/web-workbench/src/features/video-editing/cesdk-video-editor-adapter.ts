import {
  createIdempotentMountedVideoEditor,
  type VideoEditorAdapter,
} from './video-editor-adapter';

interface CesdkInstance {
  load(sceneOrUrl: string): Promise<number>;
  createFromVideo(url: string): Promise<number>;
  save(): Promise<string>;
  dispose(): void;
  engine: {
    editor: {
      onHistoryUpdatedWithKind(callback: (kind: unknown) => void): () => void;
    };
  };
  utils: {
    export(options: { mimeType: 'video/mp4' }): Promise<{ blobs: Blob[] }>;
  };
}

interface CesdkModule {
  default: {
    create(container: HTMLElement, config: Record<string, unknown>): Promise<CesdkInstance>;
  };
}

interface CesdkAdapterDependencies {
  loadSdk?: () => Promise<CesdkModule>;
}

export function createCesdkVideoEditorAdapter(
  dependencies: CesdkAdapterDependencies = {},
): VideoEditorAdapter {
  const loadSdk = dependencies.loadSdk ?? defaultLoadSdk;

  return {
    async mount(input) {
      const { default: CreativeEditorSDK } = await loadSdk();
      const cesdk = await CreativeEditorSDK.create(input.container, {
        locale: input.locale,
        ...(input.license ? { license: input.license } : {}),
      });

      if (input.sceneDocument) {
        await cesdk.load(input.sceneDocument);
      } else {
        await cesdk.createFromVideo(input.sourceUrl);
      }

      let active = true;
      let pendingSave = Promise.resolve();
      const unsubscribe = cesdk.engine.editor.onHistoryUpdatedWithKind(() => {
        pendingSave = pendingSave
          .then(async () => {
            if (!active) return;
            input.onDocumentChanged(await cesdk.save());
          })
          .catch(() => undefined);
      });

      return createIdempotentMountedVideoEditor({
        async exportMp4() {
          const { blobs } = await cesdk.utils.export({ mimeType: 'video/mp4' });
          const [video] = blobs;
          if (!video) throw new Error('CE.SDK returned no MP4 artifact');
          return video;
        },
        serialize: () => cesdk.save(),
        async destroy() {
          active = false;
          unsubscribe();
          await pendingSave;
          cesdk.dispose();
        },
      });
    },
  };
}

async function defaultLoadSdk(): Promise<CesdkModule> {
  return import('@cesdk/cesdk-js') as Promise<unknown> as Promise<CesdkModule>;
}

export const cesdkVideoEditorAdapter = createCesdkVideoEditorAdapter();
