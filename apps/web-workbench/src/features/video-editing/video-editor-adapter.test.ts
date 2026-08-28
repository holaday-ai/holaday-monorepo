import { describe, expect, it, vi } from 'vitest';
import { createCesdkVideoEditorAdapter } from './cesdk-video-editor-adapter';
import { createIdempotentMountedVideoEditor } from './video-editor-adapter';

describe('video editor adapter lifecycle', () => {
  it('releases the vendor editor once when React cleanup runs more than once', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    const editor = createIdempotentMountedVideoEditor({
      exportMp4: vi.fn().mockResolvedValue(new Blob(['video'], { type: 'video/mp4' })),
      serialize: vi.fn().mockResolvedValue('{"scene":1}'),
      destroy,
    });

    await editor.destroy();
    await editor.destroy();

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('keeps export and serialization available before destruction', async () => {
    const editor = createIdempotentMountedVideoEditor({
      exportMp4: async () => new Blob(['video'], { type: 'video/mp4' }),
      serialize: async () => '{"scene":1}',
      destroy: async () => undefined,
    });

    expect((await editor.exportMp4()).type).toBe('video/mp4');
    expect(await editor.serialize()).toBe('{"scene":1}');
  });

  it('loads an existing scene document and returns the exported MP4', async () => {
    const blob = new Blob(['video'], { type: 'video/mp4' });
    const load = vi.fn().mockResolvedValue(1);
    const createFromVideo = vi.fn().mockResolvedValue(1);
    const dispose = vi.fn();
    const unsubscribe = vi.fn();
    const instance = {
      load,
      createFromVideo,
      save: vi.fn().mockResolvedValue('UBQ2-scene'),
      dispose,
      engine: {
        editor: {
          onHistoryUpdatedWithKind: vi.fn(() => unsubscribe),
        },
      },
      utils: {
        export: vi.fn().mockResolvedValue({ blobs: [blob], options: { mimeType: 'video/mp4' } }),
      },
    };
    const create = vi.fn().mockResolvedValue(instance);
    const onDocumentChanged = vi.fn();
    const adapter = createCesdkVideoEditorAdapter({
      loadSdk: async () => ({ default: { create } }),
    });

    const mounted = await adapter.mount({
      container: {} as HTMLElement,
      license: null,
      sceneDocument: 'UBQ2-existing',
      sourceUrl: 'https://media.example.test/video.mp4',
      locale: 'zh-CN',
      onDocumentChanged,
    });

    expect(load).toHaveBeenCalledWith('UBQ2-existing');
    expect(createFromVideo).not.toHaveBeenCalled();
    expect(await mounted.serialize()).toBe('UBQ2-scene');
    expect(await mounted.exportMp4()).toBe(blob);

    await mounted.destroy();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
