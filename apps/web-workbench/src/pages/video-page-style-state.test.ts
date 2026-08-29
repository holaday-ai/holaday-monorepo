import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  IP_ASSET_AUTHORIZATION_COPY,
  IP_VIDEO_ASPECT_RATIO,
  buildCloneVideoIntent,
  buildIpVideoIntent,
  buildVideoIntentWithCreativeStyles,
  creativeModelDisplayName,
  creativeRetryPath,
  creativeTaskPath,
  currentMediaDownloadPayload,
  inferVideoStyleOption,
  modelPreviewSrc,
  normalVideoParametersAfterTabReturn,
} from './VideoPage';

describe('video creative style state', () => {
  it('contains only video creation branches while preserving the static-image quote choice', () => {
    const source = readFileSync(new URL('./VideoPage.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('ImageModeChooser');
    expect(source).not.toContain('ImageStyleDialog');
    expect(source).not.toContain("mode === 'image'");
    expect(source).toContain("confirmVideo('confirm_image')");
    expect(source).toContain("creativeTaskPath('image'");
  });

  it('keeps ignored IP engine and identity summaries out of the parameter bar', () => {
    const source = readFileSync(new URL('./VideoPage.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('label="生成引擎"');
    expect(source).not.toContain('label="人物一致性"');
  });

  it('moves the page from technical tabs to the selected scenario-first creation flow', () => {
    const source = readFileSync(new URL('./VideoPage.tsx', import.meta.url), 'utf8');

    expect(source).toContain('视频创作');
    expect(source).toContain('VideoCreationScenarioPicker');
    expect(source).toContain('VideoCreationStoryboard');
    expect(source).toContain('aria-label="视频创作工作台"');
    expect(source).toContain('告诉 HOLA DAY 你的重点');
    expect(source).toContain('查看生成设置');
    expect(source).toContain('生成这条视频');
  });

  it('keeps unavailable editing honest instead of exposing a disabled production action', () => {
    const source = readFileSync(new URL('./VideoPage.tsx', import.meta.url), 'utf8');

    expect(source).toContain('继续剪辑');
    expect(source).toContain('即将开放');
  });

  it('prevents compact unavailable history previews from stretching to the detail-column height', () => {
    const source = readFileSync(new URL('./VideoPage.tsx', import.meta.url), 'utf8');

    expect(source).toContain("cardPresentation.compact && 'self-start'");
  });

  it('keeps history details readable in narrow workbench panes and exposes the real video', () => {
    const source = readFileSync(new URL('./VideoPage.tsx', import.meta.url), 'utf8');

    expect(source).toContain('grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))]');
    expect(source).not.toContain('md:grid-cols-[minmax(260px,520px)_1fr]');
    expect(source).toContain('播放成片');
    expect(source).toContain('基础成片检查通过');
    expect(source).toContain('videoAudioVerificationBadge');
    expect(source).toContain('未记录当前基础检查');
  });

  it('lets a deep-linked media task retry an interrupted detail sync', () => {
    const source = readFileSync(new URL('./VideoPage.tsx', import.meta.url), 'utf8');
    const panelSource = source.slice(
      source.indexOf('function CurrentVideoTaskPanel'),
      source.indexOf('function videoSubStatusCopy'),
    );

    expect(panelSource).toContain("selectTask(taskId, 'url')");
    expect(panelSource).toContain('重新同步任务');
  });

  it('keeps stale IP onboarding loads and overlapping asset mutations from rolling status back', () => {
    const source = readFileSync(new URL('./VideoPage.tsx', import.meta.url), 'utf8');
    const wizardSource = source.slice(
      source.indexOf('export function IpOnboardingWizard'),
      source.indexOf('function IpGenerateForm'),
    );

    expect(wizardSource).toContain('const loadRequestRef = React.useRef(0)');
    expect(wizardSource).toContain('const requestId = ++loadRequestRef.current');
    expect(wizardSource).toContain('requestId !== loadRequestRef.current');
    expect(wizardSource).toContain('disabled={uploadingVoice || clearing}');
    expect(wizardSource).toContain('disabled={uploadingVideo || clearing}');
    expect(wizardSource).toContain(
      'disabled={!anyAsset || clearing || uploadingVoice || uploadingVideo}',
    );
  });

  it('keeps failed media retries and confirmed tasks inside the correct workspace', () => {
    expect(creativeRetryPath('image')).toBe('/image');
    expect(creativeRetryPath('video')).toBe('/video');
    expect(creativeTaskPath('image', 'task image/1')).toBe('/image?task=task%20image%2F1');
    expect(creativeTaskPath('video', 'task video/1')).toBe('/video?task=task%20video%2F1');
  });

  it('labels paid video models with the connected provider versions', () => {
    expect(creativeModelDisplayName('veo_fast')).toBe('Veo 3.1 Fast');
    expect(creativeModelDisplayName('veo_standard')).toBe('Veo 3.1 Standard');
    expect(creativeModelDisplayName('happyhorse')).toBe('Happy Horse 1.1');
  });

  it('uses an existing local model thumbnail for both clone-video models', () => {
    expect(modelPreviewSrc('wan_animate_std')).toBe('/video-style-previews/models/wanxiang.svg');
    expect(modelPreviewSrc('wan_animate_pro')).toBe('/video-style-previews/models/wanxiang.svg');
  });

  it('preserves server-confirmed file loss in the current-task download card', () => {
    expect(
      currentMediaDownloadPayload({
        fileId: 'file_gone',
        downloadUrl: '/api/files/file_gone/download',
        filename: 'result.mp4',
        mimetype: 'video/mp4',
        sizeBytes: 123,
        expiresAt: '2026-08-01T00:00:00.000Z',
        availability: 'unavailable',
        kind: 'output',
      }),
    ).toEqual({
      fileId: 'file_gone',
      downloadUrl: '/api/files/file_gone/download',
      filename: 'result.mp4',
      size: 123,
      expiresAt: '2026-08-01T00:00:00.000Z',
      unavailable: true,
    });
  });

  it('keeps randomized style choices out of the user prompt', () => {
    expect(
      buildVideoIntentWithCreativeStyles('拍一条新品介绍短视频', {
        vibe: 'random',
        lighting: 'random',
        color: 'random',
      }),
    ).toBe('拍一条新品介绍短视频');
  });

  it('reconciles a clone-only 1080p + 6s selection when returning to normal video', () => {
    expect(normalVideoParametersAfterTabReturn('wan_animate_std', '1080p', 6)).toEqual({
      model: 'veo_fast',
      resolution: '1080p',
      durationSeconds: 8,
    });
  });

  it('maps visual style picks onto supported backend style buckets', () => {
    expect(
      inferVideoStyleOption('auto', {
        vibe: 'sci_fi',
        lighting: 'random',
        color: 'random',
      }),
    ).toBe('science');
    expect(
      inferVideoStyleOption('auto', {
        vibe: 'random',
        lighting: 'golden_hour',
        color: 'warm',
      }),
    ).toBe('atmospheric');
  });

  it('keeps clone-video notes honest about what changes the provider input', () => {
    expect(buildCloneVideoIntent('保留原视频舞步，主角换成我的角色').split('\n')).toEqual([
      '复刻视频：使用单人照片替换参考视频中的单人主角，并保留参考视频的动作、镜头、节奏和音频。',
      '适配要求：主角照片与参考视频人物需取景和身体比例相近；当前模型不支持宠物、物体或多人替换。',
      '任务备注（仅用于记录，不改变本次模型输入）：保留原视频舞步，主角换成我的角色',
    ]);
  });

  it('does not promise unsupported pet or product replacement in the clone upload copy', () => {
    const source = readFileSync(new URL('./VideoPage.tsx', import.meta.url), 'utf8');

    expect(source).toContain('上传一位真人或写实虚构人物的清晰照片');
    expect(source).toContain('当前模型仅支持单人换单人');
    expect(source).toContain('取景和身体比例相近');
    expect(source).not.toContain('可以是宠物、人物或产品主体');
    expect(source).not.toContain('上传单个人物或角色的清晰照片');
  });

  it('keeps IP narration copy free of visual style instructions', () => {
    expect(
      buildIpVideoIntent('大家好，欢迎来到今天的产品介绍。', {
        vibe: 'sci_fi',
        lighting: 'golden_hour',
        color: 'warm',
      }),
    ).toBe('大家好，欢迎来到今天的产品介绍。');
  });

  it('allows truthful authorization for owned fictional AI assets', () => {
    expect(IP_ASSET_AUTHORIZATION_COPY).toContain('虚构 AI 资产');
    expect(IP_ASSET_AUTHORIZATION_COPY).toContain('合法授权');
    expect(IP_ASSET_AUTHORIZATION_COPY).not.toContain('均为本人');
  });

  it('keeps IP videos aligned to the required portrait base instead of inheriting normal ratio', () => {
    const source = readFileSync(new URL('./VideoPage.tsx', import.meta.url), 'utf8');

    expect(IP_VIDEO_ASPECT_RATIO).toBe('9:16');
    expect(source).toContain('label="画幅"');
    expect(source).toContain('value="9:16"');
    expect(source).toContain('description="跟随竖屏底版"');
  });
});
