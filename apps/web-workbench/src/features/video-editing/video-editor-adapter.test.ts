import { describe, expect, it, vi } from 'vitest';
import { createCesdkVideoEditorAdapter } from './cesdk-video-editor-adapter';
import { createIdempotentMountedVideoEditor } from './video-editor-adapter';

const DOCUMENT = {
  aspectRatio: '9:16' as const,
  scenes: [
    {
      id: 'scene_second',
      sourceFileId: 'file_b',
      sourceStartMs: 1_000,
      sourceEndMs: 4_000,
      order: 1,
      caption: '第二段字幕',
      audioGain: 0.6,
      generationContext: null,
    },
    {
      id: 'scene_first',
      sourceFileId: 'file_a',
      sourceStartMs: 2_000,
      sourceEndMs: 4_500,
      order: 0,
      caption: '第一段字幕',
      audioGain: 1,
      generationContext: null,
    },
  ],
};

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
      sourceUrls: { file_a: 'https://media.example.test/video.mp4' },
      document: DOCUMENT,
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

  it('compiles the complete immutable document instead of reopening only the original video', async () => {
    let nextId = 1;
    const createdByType = new Map<string, number[]>();
    const createBlock = vi.fn((type: string) => {
      const id = nextId++;
      createdByType.set(type, [...(createdByType.get(type) ?? []), id]);
      return id;
    });
    const block = {
      create: createBlock,
      createShape: vi.fn(() => nextId++),
      createFill: vi.fn(() => nextId++),
      appendChild: vi.fn(),
      setShape: vi.fn(),
      setFill: vi.fn(),
      setString: vi.fn(),
      forceLoadAVResource: vi.fn().mockResolvedValue(undefined),
      setTrimOffset: vi.fn(),
      setTrimLength: vi.fn(),
      setDuration: vi.fn(),
      setVolume: vi.fn(),
      fillParent: vi.fn(),
      setAlwaysOnBottom: vi.fn(),
      setPageDurationSource: vi.fn(),
      setWidth: vi.fn(),
      setHeight: vi.fn(),
      setPositionX: vi.fn(),
      setPositionY: vi.fn(),
      setTimeOffset: vi.fn(),
      replaceText: vi.fn(),
      setTextFontSize: vi.fn(),
      setTextHorizontalAlignment: vi.fn(),
      setTextColor: vi.fn(),
    };
    const scene = { createVideo: vi.fn(() => nextId++) };
    const instance = {
      load: vi.fn().mockResolvedValue(1),
      createFromVideo: vi.fn().mockResolvedValue(1),
      save: vi.fn().mockResolvedValue('UBQ2-compiled'),
      dispose: vi.fn(),
      engine: {
        scene,
        block,
        editor: { onHistoryUpdatedWithKind: vi.fn(() => vi.fn()) },
      },
      utils: { export: vi.fn().mockResolvedValue({ blobs: [] }) },
    };
    const create = vi.fn().mockResolvedValue(instance);
    const adapter = createCesdkVideoEditorAdapter({
      loadSdk: async () => ({ default: { create } }),
    });

    const mounted = await adapter.mount({
      container: {} as HTMLElement,
      license: 'browser-license',
      sceneDocument: null,
      sourceUrl: 'https://media.example.test/fallback.mp4',
      sourceUrls: {
        file_a: 'https://media.example.test/a.mp4',
        file_b: 'https://media.example.test/b.mp4',
      },
      document: DOCUMENT,
      locale: 'zh-CN',
      onDocumentChanged: vi.fn(),
    });

    expect(create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        locale: 'zh-CN',
        license: 'browser-license',
        ui: {
          elements: {
            view: 'default',
            panels: { assetLibrary: false, settings: false },
            dock: { show: false },
          },
        },
      }),
    );
    expect(instance.createFromVideo).not.toHaveBeenCalled();
    expect(instance.load).not.toHaveBeenCalled();
    expect(scene.createVideo).toHaveBeenCalledTimes(1);

    const [page] = createdByType.get('page') ?? [];
    const [track] = createdByType.get('track') ?? [];
    const graphics = createdByType.get('graphic') ?? [];
    const captions = createdByType.get('text') ?? [];
    expect(block.setWidth).toHaveBeenCalledWith(page, 1080);
    expect(block.setHeight).toHaveBeenCalledWith(page, 1920);
    expect(block.setPageDurationSource).toHaveBeenCalledWith(page, track);
    expect(graphics).toHaveLength(2);
    expect(captions).toHaveLength(2);
    expect(block.setString.mock.calls.filter((call) => call[1] === 'fill/video/fileURI')).toEqual([
      [expect.any(Number), 'fill/video/fileURI', 'https://media.example.test/a.mp4'],
      [expect.any(Number), 'fill/video/fileURI', 'https://media.example.test/b.mp4'],
    ]);
    expect(block.setTrimOffset.mock.calls).toEqual([
      [expect.any(Number), 2],
      [expect.any(Number), 1],
    ]);
    expect(block.setTrimLength.mock.calls).toEqual([
      [expect.any(Number), 2.5],
      [expect.any(Number), 3],
    ]);
    expect(block.replaceText.mock.calls).toEqual([
      [captions[0], '第一段字幕'],
      [captions[1], '第二段字幕'],
    ]);
    expect(block.setTimeOffset.mock.calls).toEqual([
      [captions[0], 0],
      [captions[1], 2.5],
    ]);

    expect(await mounted.serialize()).toBe('UBQ2-compiled');
    await mounted.destroy();
  });
});
