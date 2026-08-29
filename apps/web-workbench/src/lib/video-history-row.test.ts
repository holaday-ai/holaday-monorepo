import { describe, expect, it } from 'vitest';
import {
  asVideoType,
  canChangeCreativeHistoryFilter,
  canLoadOlderCreativeHistory,
  creativeHistoryArtifactAvailability,
  creativeHistoryCardPresentation,
  creativeHistoryDisplayTitle,
  creativeHistoryListInput,
  creativeHistoryLoadReducer,
  creativeHistoryPreviewAvailability,
  filterCreativeHistoryRows,
  isVideoLane,
  mergeCreativeHistoryRows,
  nextCreativeHistoryVisibleCount,
  showImageOption,
  toVideoRow,
  videoAudioVerificationBadge,
} from './video-history-row';

describe('creative history artifact availability', () => {
  it('distinguishes active, expired, and unknown history files', () => {
    const now = Date.parse('2026-07-23T10:00:00.000Z');
    expect(
      creativeHistoryArtifactAvailability({ expiresAt: '2026-07-23T10:00:01.000Z' }, now),
    ).toBe('available');
    expect(
      creativeHistoryArtifactAvailability({ expiresAt: '2026-07-23T09:59:59.000Z' }, now),
    ).toBe('expired');
    expect(creativeHistoryArtifactAvailability(undefined, now)).toBe('unknown');
  });

  it('lets server-confirmed unavailability override a future expiry', () => {
    const now = Date.parse('2026-07-23T10:00:00.000Z');
    expect(
      creativeHistoryArtifactAvailability(
        {
          expiresAt: '2026-07-23T11:00:00.000Z',
          unavailable: true,
        },
        now,
      ),
    ).toBe('unavailable');
  });
});

describe('creative history preview availability', () => {
  const now = Date.parse('2026-07-23T10:00:00.000Z');

  it('keeps an unavailable poster distinct from an expired output file', () => {
    expect(
      creativeHistoryPreviewAvailability({
        download: {},
        posterUrl: '/api/files/poster-stale/download',
        unavailablePosterUrls: new Set(['/api/files/poster-stale/download']),
        now,
      }),
    ).toBe('unavailable');
  });

  it('lets known file expiry take precedence over poster state', () => {
    expect(
      creativeHistoryPreviewAvailability({
        download: { expiresAt: '2026-07-23T09:59:59.000Z' },
        posterUrl: '/api/files/poster-stale/download',
        unavailablePosterUrls: new Set(['/api/files/poster-stale/download']),
        now,
      }),
    ).toBe('expired');
  });

  it('does not attempt a poster when the output file is unavailable', () => {
    expect(
      creativeHistoryPreviewAvailability({
        download: { unavailable: true },
        posterUrl: '/api/files/poster-active/download',
        unavailablePosterUrls: new Set(),
        now,
      }),
    ).toBe('unavailable');
  });

  it('does not request a server-confirmed unavailable poster', () => {
    expect(
      creativeHistoryPreviewAvailability({
        download: { expiresAt: '2026-07-23T11:00:00.000Z' },
        posterUrl: '/api/files/poster-missing/download',
        posterUnavailable: true,
        unavailablePosterUrls: new Set(),
        now,
      }),
    ).toBe('unavailable');
  });

  it('distinguishes a fetchable poster from a missing poster', () => {
    expect(
      creativeHistoryPreviewAvailability({
        download: {},
        posterUrl: '/api/files/poster-active/download',
        unavailablePosterUrls: new Set(),
        now,
      }),
    ).toBe('available');
    expect(
      creativeHistoryPreviewAvailability({
        download: {},
        unavailablePosterUrls: new Set(),
        now,
      }),
    ).toBe('missing');
  });
});

describe('creative history card presentation', () => {
  it('keeps expired and unavailable previews truthful without letting them dominate the page', () => {
    expect(creativeHistoryCardPresentation('expired')).toEqual({ compact: true, minHeight: 112 });
    expect(creativeHistoryCardPresentation('unavailable')).toEqual({
      compact: true,
      minHeight: 112,
    });
    expect(creativeHistoryCardPresentation('available')).toEqual({
      compact: false,
      minHeight: 184,
    });
    expect(creativeHistoryCardPresentation('missing')).toEqual({ compact: false, minHeight: 184 });
  });
});

describe('showImageOption — 图片版 gate (B2)', () => {
  it('hides 图片版 for ip_person only', () => {
    expect(showImageOption('ip_person')).toBe(false);
  });
  it('shows it for normal / pet', () => {
    expect(showImageOption('normal')).toBe(true);
    expect(showImageOption('pet')).toBe(true);
  });
  it('shows it for unknown / legacy (undefined) — safe default', () => {
    expect(showImageOption(undefined)).toBe(true);
  });
});

describe('asVideoType — enum narrowing (A3/A5)', () => {
  it('keeps the three valid values, drops the rest', () => {
    expect(asVideoType('normal')).toBe('normal');
    expect(asVideoType('pet')).toBe('pet');
    expect(asVideoType('ip_person')).toBe('ip_person');
    expect(asVideoType('bogus')).toBeUndefined();
    expect(asVideoType(undefined)).toBeUndefined();
    expect(asVideoType(42)).toBeUndefined();
  });
});

describe('toVideoRow — videoType + posterUrl extraction (A4/A5)', () => {
  it('extracts metadata.videoType + attachment.posterUrl', () => {
    const out = toVideoRow({
      taskId: 'tsk_ip',
      status: 'completed',
      result: {
        metadata: {
          lane: 'video_creation',
          videoType: 'ip_person',
          attachments: [
            {
              fileId: 'f',
              downloadUrl: '/api/files/f/download',
              filename: 'v.mp4',
              sizeBytes: 5_000_000,
              posterUrl: '/api/files/p/download',
              expiresAt: '2026-07-24T10:00:00.000Z',
            },
          ],
        },
      },
    });
    expect(out?.videoType).toBe('ip_person');
    expect(out?.posterUrl).toBe('/api/files/p/download');
    expect(out?.download?.expiresAt).toBe('2026-07-24T10:00:00.000Z');
  });

  it('preserves a server-confirmed unavailable poster state', () => {
    const out = toVideoRow({
      taskId: 'tsk_poster_unavailable',
      status: 'completed',
      createdAt: '2026-07-16T00:00:00.000Z',
      result: {
        metadata: {
          lane: 'video_creation',
          attachments: [
            {
              fileId: 'file_video',
              downloadUrl: '/api/files/file_video/download',
              filename: 'holaday-video.mp4',
              sizeBytes: 2048,
              posterUrl: '/api/files/file_poster/download',
              posterAvailability: 'unavailable',
            },
          ],
        },
      },
    });

    expect(out?.posterUrl).toBe('/api/files/file_poster/download');
    expect(out?.posterUnavailable).toBe(true);
  });

  it('omits videoType when invalid/absent, posterUrl when absent', () => {
    const out = toVideoRow({
      taskId: 'tsk_n',
      status: 'completed',
      result: {
        metadata: {
          lane: 'video_creation',
          videoType: 'weird',
          attachments: [
            {
              fileId: 'f',
              downloadUrl: '/api/files/f/download',
              filename: 'v.mp4',
              sizeBytes: 1000,
            },
          ],
        },
      },
    });
    expect(out).not.toBeNull();
    expect(out?.videoType).toBeUndefined();
    expect(out?.posterUrl).toBeUndefined();
  });

  it('recovers the IP-person type from the legacy output filename', () => {
    const out = toVideoRow({
      taskId: 'tsk_legacy_ip',
      intent: '欢迎来到今天的产品介绍。',
      status: 'completed',
      result: {
        metadata: {
          lane: 'video_creation',
          attachments: [
            {
              fileId: 'f_ip',
              downloadUrl: '/api/files/f_ip/download',
              filename: 'holaday-ip-video.mp4',
              sizeBytes: 5_000_000,
            },
          ],
        },
      },
    });
    expect(out?.videoType).toBe('ip_person');
  });

  it('recovers the clone-video type from the product-stamped legacy intent', () => {
    const out = toVideoRow({
      taskId: 'tsk_legacy_clone',
      intent:
        '复刻视频：使用上传照片替换参考视频中的主角，并保留参考视频的动作、镜头、节奏和音频。',
      status: 'completed',
      result: {
        metadata: {
          lane: 'video_creation',
          attachments: [
            {
              fileId: 'f_clone',
              downloadUrl: '/api/files/f_clone/download',
              filename: 'holaday-video.mp4',
              sizeBytes: 5_000_000,
            },
          ],
        },
      },
    });
    expect(out?.videoType).toBe('pet');
  });
});

const ATT = {
  fileId: 'file_x',
  downloadUrl: '/api/files/file_x/download',
  filename: 'holaday-video.mp4',
  sizeBytes: 6_000_000,
};

function row(over: Record<string, unknown> = {}): unknown {
  return {
    taskId: 'tsk_1',
    intent: '夏天防晒',
    title: null,
    status: 'completed',
    createdAt: '2026-06-19T00:00:00.000Z',
    result: { metadata: { lane: 'video_creation', attachments: [ATT] } },
    ...over,
  };
}

describe('isVideoLane', () => {
  it('matches video_creation* lanes only', () => {
    expect(isVideoLane('video_creation')).toBe(true);
    expect(isVideoLane('video_creation_consumed')).toBe(true);
    expect(isVideoLane('generate')).toBe(false);
    expect(isVideoLane(undefined)).toBe(false);
  });
});

describe('toVideoRow — 生成历史 only lists completed 成片 with an attachment', () => {
  it('completed + valid attachment → row carrying the download', () => {
    const out = toVideoRow(row());
    expect(out).not.toBeNull();
    expect(out?.taskId).toBe('tsk_1');
    expect(out?.download).toEqual({
      fileId: 'file_x',
      downloadUrl: '/api/files/file_x/download',
      filename: 'holaday-video.mp4',
      size: 6_000_000,
    });
    expect(out?.mimetype).toBe('video/mp4');
  });

  it('carries the persisted pin state into video history', () => {
    const starredAt = '2026-07-23T08:30:00.000Z';
    const out = toVideoRow(row({ starred: true, starredAt }));
    expect(out?.starred).toBe(true);
    expect(out?.starredAt).toBe(starredAt);
  });

  it('distinguishes current quality-gated deliverables from legacy or superseded checks', () => {
    const verified = toVideoRow(
      row({
        result: {
          metadata: {
            lane: 'video_creation',
            attachments: [ATT],
            qualityVerification: {
              status: 'passed',
              gateVersion: 'video-final-v3',
              verifiedAt: '2026-07-25T06:00:00.000Z',
              coverage: {
                playableVideo: 'verified',
                sampledFrames: 'verified',
                audibleAudio: 'verified',
                audiovisualSync: 'not_verified',
                lipSyncProcessing: 'completed',
              },
            },
          },
        },
      }),
    );
    const superseded = toVideoRow(
      row({
        result: {
          metadata: {
            lane: 'video_creation',
            attachments: [ATT],
            qualityVerification: {
              status: 'passed',
              gateVersion: 'video-final-v1',
              verifiedAt: '2026-07-25T05:00:00.000Z',
            },
          },
        },
      }),
    );
    const legacy = toVideoRow(row());

    expect(verified?.qualityVerification?.status).toBe('passed');
    expect(verified?.qualityVerification?.coverage).toEqual({
      playableVideo: 'verified',
      sampledFrames: 'verified',
      audibleAudio: 'verified',
      audiovisualSync: 'not_verified',
      lipSyncProcessing: 'completed',
    });
    expect(superseded?.qualityVerification).toBeUndefined();
    expect(legacy?.qualityVerification).toBeUndefined();
  });

  it('rejects contradictory audio coverage instead of showing an AV-sync warning', () => {
    const contradictory = toVideoRow(
      row({
        result: {
          metadata: {
            lane: 'video_creation',
            attachments: [ATT],
            qualityVerification: {
              status: 'passed',
              gateVersion: 'video-final-v3',
              verifiedAt: '2026-07-25T06:00:00.000Z',
              coverage: {
                playableVideo: 'verified',
                sampledFrames: 'verified',
                audibleAudio: 'not_verified',
                audiovisualSync: 'not_verified',
              },
            },
          },
        },
      }),
    );

    expect(contradictory?.qualityVerification).toBeUndefined();
  });

  it('keeps current-gate legacy rows readable without manufacturing a lip-sync process result', () => {
    const legacyCoverage = toVideoRow(
      row({
        result: {
          metadata: {
            lane: 'video_creation',
            attachments: [ATT],
            qualityVerification: {
              status: 'passed',
              gateVersion: 'video-final-v3',
              verifiedAt: '2026-07-25T06:00:00.000Z',
              coverage: {
                playableVideo: 'verified',
                sampledFrames: 'verified',
                audibleAudio: 'verified',
                audiovisualSync: 'not_verified',
              },
            },
          },
        },
      }),
    );

    expect(legacyCoverage?.qualityVerification?.coverage).toEqual({
      playableVideo: 'verified',
      sampledFrames: 'verified',
      audibleAudio: 'verified',
      audiovisualSync: 'not_verified',
    });
  });

  it('rejects a claimed audible lip-sync result when processing is marked not applicable', () => {
    const contradictoryProcess = toVideoRow(
      row({
        result: {
          metadata: {
            lane: 'video_creation',
            attachments: [ATT],
            qualityVerification: {
              status: 'passed',
              gateVersion: 'video-final-v3',
              verifiedAt: '2026-07-25T06:00:00.000Z',
              coverage: {
                playableVideo: 'verified',
                sampledFrames: 'verified',
                audibleAudio: 'verified',
                audiovisualSync: 'not_verified',
                lipSyncProcessing: 'not_applicable',
              },
            },
          },
        },
      }),
    );

    expect(contradictoryProcess?.qualityVerification).toBeUndefined();
  });

  it('renders provider processing separately from independent AV-sync verification', () => {
    const processed = toVideoRow(
      row({
        result: {
          metadata: {
            lane: 'video_creation',
            attachments: [ATT],
            qualityVerification: {
              status: 'passed',
              gateVersion: 'video-final-v3',
              verifiedAt: '2026-07-25T06:00:00.000Z',
              coverage: {
                playableVideo: 'verified',
                sampledFrames: 'verified',
                audibleAudio: 'verified',
                audiovisualSync: 'not_verified',
                lipSyncProcessing: 'completed',
              },
            },
          },
        },
      }),
    );
    const legacy = toVideoRow(
      row({
        result: {
          metadata: {
            lane: 'video_creation',
            attachments: [ATT],
            qualityVerification: {
              status: 'passed',
              gateVersion: 'video-final-v3',
              verifiedAt: '2026-07-25T06:00:00.000Z',
              coverage: {
                playableVideo: 'verified',
                sampledFrames: 'verified',
                audibleAudio: 'verified',
                audiovisualSync: 'not_verified',
              },
            },
          },
        },
      }),
    );

    expect(videoAudioVerificationBadge(processed?.qualityVerification)).toMatchObject({
      label: '口型已处理 · 准确度待确认',
      title: expect.stringContaining('尚未独立验证'),
    });
    expect(videoAudioVerificationBadge(legacy?.qualityVerification)).toMatchObject({
      label: '音画同步未验证',
    });
    expect(videoAudioVerificationBadge(undefined)).toBeNull();
  });

  it('labels independent multimodal review without presenting it as human verification', () => {
    expect(
      videoAudioVerificationBadge({
        status: 'passed',
        gateVersion: 'video-final-v4',
        verifiedAt: '2026-07-29T00:00:00.000Z',
        audiovisualSyncReview: {
          model: 'gemini-3.6-flash',
          evidence: [
            { startSeconds: 0.5, endSeconds: 2 },
            { startSeconds: 4, endSeconds: 6 },
          ],
        },
        coverage: {
          playableVideo: 'verified',
          sampledFrames: 'verified',
          audibleAudio: 'verified',
          audiovisualSync: 'verified_ai',
          lipSyncProcessing: 'completed',
        },
      }),
    ).toEqual({
      label: '音画同步 AI 复核通过',
      title:
        '独立多模态模型已检查声音和嘴部运动；证据时间窗：0.5–2 秒、4–6 秒。这是自动复核，不替代人工逐帧验收',
    });
  });

  it('does not surface a current-gate verified badge without auditable time windows', () => {
    const unsubstantiated = toVideoRow(
      row({
        result: {
          metadata: {
            lane: 'video_creation',
            attachments: [ATT],
            qualityVerification: {
              status: 'passed',
              gateVersion: 'video-final-v4',
              verifiedAt: '2026-07-29T00:00:00.000Z',
              coverage: {
                playableVideo: 'verified',
                sampledFrames: 'verified',
                audibleAudio: 'verified',
                audiovisualSync: 'verified_ai',
                lipSyncProcessing: 'completed',
              },
            },
          },
        },
      }),
    );

    expect(unsubstantiated?.qualityVerification).toBeUndefined();
    expect(videoAudioVerificationBadge(unsubstantiated?.qualityVerification)).toBeNull();
  });

  it('normalizes backend /files download URLs to the frontend /api/files path', () => {
    const out = toVideoRow(
      row({
        result: {
          metadata: {
            lane: 'video_creation',
            attachments: [
              {
                ...ATT,
                downloadUrl: '/files/file_x/download',
                posterUrl: '/files/poster_x/download',
              },
            ],
          },
        },
      }),
    );
    expect(out?.download?.downloadUrl).toBe('/api/files/file_x/download');
    expect(out?.posterUrl).toBe('/api/files/poster_x/download');
  });

  it('DROPS failed (the face-detection failure no longer pollutes history)', () => {
    expect(
      toVideoRow(row({ status: 'failed', result: { metadata: { lane: 'video_creation' } } })),
    ).toBeNull();
  });

  it('keeps review-needed video outputs when a downloadable attachment exists', () => {
    const out = toVideoRow(row({ status: 'partial_success' }));
    expect(out?.status).toBe('partial_success');
    expect(out?.download?.downloadUrl).toBe('/api/files/file_x/download');
  });

  it('DROPS cancelled', () => {
    expect(toVideoRow(row({ status: 'cancelled' }))).toBeNull();
  });

  it('DROPS awaiting_user 报价 stub (lane video_creation_consumed, no attachment)', () => {
    expect(
      toVideoRow({
        taskId: 'tsk_q',
        status: 'awaiting_user',
        result: { metadata: { lane: 'video_creation_consumed' } },
      }),
    ).toBeNull();
  });

  it('DROPS executing (still generating)', () => {
    expect(
      toVideoRow(row({ status: 'executing', result: { metadata: { lane: 'video_creation' } } })),
    ).toBeNull();
  });

  it('DROPS completed but NO attachment', () => {
    expect(
      toVideoRow(row({ result: { metadata: { lane: 'video_creation', attachments: [] } } })),
    ).toBeNull();
    expect(toVideoRow(row({ result: { metadata: { lane: 'video_creation' } } }))).toBeNull();
  });

  it('DROPS completed attachment missing sizeBytes (incomplete payload)', () => {
    const bad = { fileId: 'f', downloadUrl: '/api/files/f/download', filename: 'v.mp4' };
    expect(
      toVideoRow(row({ result: { metadata: { lane: 'video_creation', attachments: [bad] } } })),
    ).toBeNull();
  });

  it('DROPS non-video lane even when completed with an attachment', () => {
    expect(
      toVideoRow(row({ result: { metadata: { lane: 'generate', attachments: [ATT] } } })),
    ).toBeNull();
  });

  it('DROPS junk input', () => {
    expect(toVideoRow(null)).toBeNull();
    expect(toVideoRow('nope')).toBeNull();
    expect(toVideoRow({})).toBeNull();
  });
});

describe('creative history filters', () => {
  const videoDownload = {
    fileId: 'file_video',
    downloadUrl: '/api/files/file_video/download',
    filename: 'holaday-video.mp4',
    size: 3_000_000,
  };
  const rows = [
    {
      taskId: 'video_pinned',
      intent: '生成视频：置顶视频',
      title: null,
      status: 'completed',
      createdAt: '2026-07-23T00:00:00.000Z',
      download: videoDownload,
      videoType: 'normal' as const,
      starred: true,
    },
  ];

  it('keeps video history scoped to the active video type', () => {
    expect(
      filterCreativeHistoryRows(rows, {
        videoType: 'normal',
        filter: 'all',
        now: Date.parse('2026-07-24T00:00:00.000Z'),
      }).map((row) => row.taskId),
    ).toEqual(['video_pinned']);
  });

  it('builds persisted pin and rolling recent server constraints', () => {
    expect(creativeHistoryListInput('pinned')).toEqual({
      limit: 50,
      status: ['completed', 'partial_success'],
      starred: true,
    });
    expect(creativeHistoryListInput('all', 1700000000000)).toEqual({
      limit: 50,
      cursor: 1700000000000,
      status: ['completed', 'partial_success'],
    });
    expect(
      creativeHistoryListInput('recent', undefined, Date.parse('2026-07-24T00:00:00.000Z')),
    ).toEqual({
      limit: 50,
      status: ['completed', 'partial_success'],
      dateFrom: new Date('2026-07-17T00:00:00.000Z'),
    });
  });
});

describe('creative history display copy', () => {
  it('replaces leaked IP onboarding boilerplate with the product type label', () => {
    const internalCopy = [
      '· 声音样本在克隆出声纹后即刻删除,我们只保留声纹用于合成。',
      '· 出镜底版加密存储、仅用于你本人的视频,可随时删除/重传。',
      '· 一键清除会删掉云端声纹 + 出镜底版 + 授权记录。',
    ].join(' ');
    expect(
      creativeHistoryDisplayTitle({
        title: internalCopy,
        intent: internalCopy,
        videoType: 'ip_person',
      }),
    ).toBe('IP人物视频');
  });

  it('keeps a real user video prompt visible', () => {
    expect(
      creativeHistoryDisplayTitle({
        title: null,
        intent: '让西高地在海边奔跑，镜头平稳跟随。',
        videoType: 'normal',
      }),
    ).toBe('让西高地在海边奔跑，镜头平稳跟随。');
  });

  it('shows the user note instead of clone-video routing instructions', () => {
    expect(
      creativeHistoryDisplayTitle({
        title: null,
        intent: [
          '复刻视频：使用上传照片替换参考视频中的主角，并保留参考视频的动作、镜头、节奏和音频。',
          '任务备注（仅用于记录，不改变本次模型输入）：把主角换成我的西高地。',
        ].join('\n'),
        videoType: 'pet',
      }),
    ).toBe('把主角换成我的西高地。');
  });

  it('uses the clone-video label when there is no user note', () => {
    expect(
      creativeHistoryDisplayTitle({
        title: null,
        intent:
          '复刻视频：使用上传照片替换参考视频中的主角，并保留参考视频的动作、镜头、节奏和音频。',
        videoType: 'pet',
      }),
    ).toBe('复刻视频');
  });
});

describe('creative history load state', () => {
  const existingRow = {
    taskId: 'img_existing',
    intent: '生成图片：已存在作品',
    title: null,
    status: 'completed',
    createdAt: '2026-07-23T00:00:00.000Z',
    download: {
      fileId: 'file_img',
      downloadUrl: '/api/files/file_img/download',
      filename: 'holaday-image.jpg',
      size: 512_000,
    },
  };

  it('shows an honest error state when the initial request fails', () => {
    const loading = creativeHistoryLoadReducer(
      { rows: null, loading: false, error: false },
      { type: 'start' },
    );
    expect(creativeHistoryLoadReducer(loading, { type: 'failure' })).toEqual({
      rows: null,
      loading: false,
      error: true,
    });
  });

  it('preserves previously loaded work when a refresh fails', () => {
    const current = { rows: [existingRow], loading: true, error: false };
    expect(creativeHistoryLoadReducer(current, { type: 'failure' })).toEqual({
      rows: [existingRow],
      loading: false,
      error: true,
    });
  });

  it('replaces rows and clears the error after a successful retry', () => {
    expect(
      creativeHistoryLoadReducer(
        { rows: null, loading: true, error: true },
        { type: 'success', rows: [existingRow] },
      ),
    ).toEqual({
      rows: [existingRow],
      loading: false,
      error: false,
    });
  });

  it('updates one pin without clearing an in-flight load or cached error state', () => {
    expect(
      creativeHistoryLoadReducer(
        { rows: [existingRow], loading: true, error: true },
        {
          type: 'update_pin',
          taskId: existingRow.taskId,
          starred: true,
          starredAt: '2026-07-23T08:30:00.000Z',
        },
      ),
    ).toEqual({
      rows: [
        {
          ...existingRow,
          starred: true,
          starredAt: '2026-07-23T08:30:00.000Z',
        },
      ],
      loading: true,
      error: true,
    });
  });

  it('appends older pages without duplicating rows already shown', () => {
    const olderRow = {
      ...existingRow,
      taskId: 'img_older',
      createdAt: '2026-07-22T00:00:00.000Z',
    };
    expect(
      creativeHistoryLoadReducer(
        { rows: [existingRow], loading: false, error: false },
        { type: 'append', rows: [existingRow, olderRow] },
      ).rows?.map((row) => row.taskId),
    ).toEqual(['img_existing', 'img_older']);
    expect(mergeCreativeHistoryRows([existingRow], [existingRow, olderRow])).toHaveLength(2);
  });
});

describe('creative history progressive disclosure', () => {
  it('reveals four more rows at a time and clamps to the total', () => {
    expect(nextCreativeHistoryVisibleCount(4, 11)).toBe(8);
    expect(nextCreativeHistoryVisibleCount(8, 11)).toBe(11);
    expect(nextCreativeHistoryVisibleCount(11, 11)).toBe(11);
  });

  it('keeps the active filter stable while a pin write is pending', () => {
    expect(canChangeCreativeHistoryFilter(null)).toBe(true);
    expect(canChangeCreativeHistoryFilter('tsk_pinning')).toBe(false);
  });

  it('does not start an older-page request while a refresh is active', () => {
    expect(
      canLoadOlderCreativeHistory({
        loading: true,
        loadingMore: false,
        nextCursor: 120,
      }),
    ).toBe(false);
    expect(
      canLoadOlderCreativeHistory({
        loading: false,
        loadingMore: true,
        nextCursor: 120,
      }),
    ).toBe(false);
    expect(
      canLoadOlderCreativeHistory({
        loading: false,
        loadingMore: false,
        nextCursor: null,
      }),
    ).toBe(false);
    expect(
      canLoadOlderCreativeHistory({
        loading: false,
        loadingMore: false,
        nextCursor: 120,
      }),
    ).toBe(true);
  });
});
