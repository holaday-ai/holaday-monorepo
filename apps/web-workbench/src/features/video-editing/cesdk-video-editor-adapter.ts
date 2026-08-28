import {
  createIdempotentMountedVideoEditor,
  type VideoEditorAdapter,
} from './video-editor-adapter';
import type { VideoEditingDocument } from './video-editing-state';

type CesdkBlockId = number;

interface CesdkBlockApi {
  create(type: 'page' | 'track' | 'graphic' | 'text'): CesdkBlockId;
  createShape(type: 'rect'): CesdkBlockId;
  createFill(type: 'video'): CesdkBlockId;
  appendChild(parent: CesdkBlockId, child: CesdkBlockId): void;
  setShape(block: CesdkBlockId, shape: CesdkBlockId): void;
  setFill(block: CesdkBlockId, fill: CesdkBlockId): void;
  setString(block: CesdkBlockId, property: string, value: string): void;
  forceLoadAVResource(block: CesdkBlockId): Promise<void>;
  setTrimOffset(block: CesdkBlockId, seconds: number): void;
  setTrimLength(block: CesdkBlockId, seconds: number): void;
  setDuration(block: CesdkBlockId, seconds: number): void;
  setTimeOffset(block: CesdkBlockId, seconds: number): void;
  setVolume(block: CesdkBlockId, volume: number): void;
  fillParent(block: CesdkBlockId): void;
  setAlwaysOnBottom(block: CesdkBlockId, enabled: boolean): void;
  setPageDurationSource(page: CesdkBlockId, source: CesdkBlockId): void;
  setWidth(block: CesdkBlockId, width: number): void;
  setHeight(block: CesdkBlockId, height: number): void;
  setPositionX(block: CesdkBlockId, x: number): void;
  setPositionY(block: CesdkBlockId, y: number): void;
  setContentFillMode?(block: CesdkBlockId, mode: 'Cover'): void;
  replaceText(block: CesdkBlockId, text: string): void;
  setTextFontSize(block: CesdkBlockId, size: number): void;
  setTextHorizontalAlignment(block: CesdkBlockId, alignment: 'Center'): void;
  setTextColor(
    block: CesdkBlockId,
    color: { r: number; g: number; b: number; a: number },
  ): void;
}

interface CesdkEngine {
  scene: { createVideo(): CesdkBlockId };
  block: CesdkBlockApi;
  editor: {
    onHistoryUpdatedWithKind(callback: (kind: unknown) => void): () => void;
  };
}

interface CesdkInstance {
  load(sceneOrUrl: string): Promise<number>;
  createFromVideo(url: string): Promise<number>;
  save(): Promise<string>;
  dispose(): void;
  engine: CesdkEngine;
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

const CANVAS_SIZE: Record<VideoEditingDocument['aspectRatio'], { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
};

/**
 * Compile Holaday's immutable, vendor-neutral edit document into a CE.SDK video scene.
 * Exports then reflect every trim, reorder, caption and aspect-ratio operation instead
 * of silently reopening the original source asset.
 */
export async function compileVideoEditingDocument(input: {
  engine: CesdkEngine;
  document: VideoEditingDocument;
  sourceUrls: Record<string, string>;
}): Promise<void> {
  const { engine, document, sourceUrls } = input;
  const { width, height } = CANVAS_SIZE[document.aspectRatio];
  const scene = engine.scene.createVideo();
  const page = engine.block.create('page');
  engine.block.appendChild(scene, page);
  engine.block.setWidth(page, width);
  engine.block.setHeight(page, height);

  const track = engine.block.create('track');
  engine.block.appendChild(page, track);
  engine.block.fillParent(track);
  engine.block.setAlwaysOnBottom(track, true);
  engine.block.setPageDurationSource(page, track);

  let timelineOffsetSeconds = 0;
  const scenes = [...document.scenes].sort((left, right) => left.order - right.order);
  for (const editScene of scenes) {
    const sourceUrl = sourceUrls[editScene.sourceFileId];
    if (!sourceUrl) throw new Error(`Missing scoped source URL for ${editScene.sourceFileId}`);
    const durationSeconds = (editScene.sourceEndMs - editScene.sourceStartMs) / 1_000;

    const graphic = engine.block.create('graphic');
    const shape = engine.block.createShape('rect');
    const fill = engine.block.createFill('video');
    engine.block.setShape(graphic, shape);
    engine.block.setFill(graphic, fill);
    engine.block.setString(fill, 'fill/video/fileURI', sourceUrl);
    await engine.block.forceLoadAVResource(fill);
    engine.block.setTrimOffset(fill, editScene.sourceStartMs / 1_000);
    engine.block.setTrimLength(fill, durationSeconds);
    engine.block.setDuration(graphic, durationSeconds);
    engine.block.setVolume(fill, Math.min(1, Math.max(0, editScene.audioGain)));
    engine.block.setContentFillMode?.(graphic, 'Cover');
    engine.block.fillParent(graphic);
    engine.block.appendChild(track, graphic);

    const caption = editScene.caption.trim();
    if (caption) {
      const text = engine.block.create('text');
      engine.block.replaceText(text, caption);
      engine.block.setTimeOffset(text, timelineOffsetSeconds);
      engine.block.setDuration(text, durationSeconds);
      engine.block.setWidth(text, width * 0.9);
      engine.block.setHeight(text, Math.max(96, height * 0.09));
      engine.block.setPositionX(text, width * 0.05);
      engine.block.setPositionY(text, height * 0.8);
      engine.block.setTextFontSize(text, Math.max(42, Math.round(width * 0.045)));
      engine.block.setTextHorizontalAlignment(text, 'Center');
      engine.block.setTextColor(text, { r: 1, g: 1, b: 1, a: 1 });
      engine.block.appendChild(page, text);
    }

    timelineOffsetSeconds += durationSeconds;
  }
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
        ui: {
          elements: {
            view: 'default',
            panels: { assetLibrary: false, settings: false },
            dock: { show: false },
          },
        },
      });

      if (input.sceneDocument) {
        await cesdk.load(input.sceneDocument);
      } else {
        await compileVideoEditingDocument({
          engine: cesdk.engine,
          document: input.document,
          sourceUrls: input.sourceUrls,
        });
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
