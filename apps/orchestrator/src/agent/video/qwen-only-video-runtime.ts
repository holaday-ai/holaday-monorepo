import type {
  VerifyAudioVisualSyncInput,
  VideoAvSyncReview,
  VideoAvSyncVerifierDeps,
} from './video-av-sync-verifier.js';
import type {
  CloneVideoInput,
  CloneVideoOptions,
  CloneVideoResult,
  CloneVideoServices,
} from './video-clone.js';
import type {
  IpVideoConfig,
  IpVideoContext,
  IpVideoOptions,
  IpVideoResult,
  IpVideoServices,
} from './video-ip-lipsync.js';
import type {
  RunSimpleVideoInput,
  SimpleVideoConfig,
  SimpleVideoOptions,
  SimpleVideoResult,
  SimpleVideoServices,
} from './video-lane-simple.js';
import type {
  PetVideoInput,
  PetVideoOptions,
  PetVideoResult,
  PetVideoServices,
} from './video-pet-i2v.js';

/** Production-safe boundary for the not-yet-migrated video generation lane. */
export async function runSimpleVideoCreation(
  _input: RunSimpleVideoInput,
  _config: SimpleVideoConfig,
  _options: SimpleVideoOptions,
  _services: SimpleVideoServices,
): Promise<SimpleVideoResult> {
  throw new Error('视频能力正在迁移到千问，暂时不可用。');
}

export async function runCloneVideoCreation(
  _input: CloneVideoInput,
  _config: SimpleVideoConfig,
  _options: CloneVideoOptions,
  _services: CloneVideoServices,
): Promise<CloneVideoResult> {
  throw new Error('视频能力正在迁移到千问，暂时不可用。');
}

export async function runPetVideoCreation(
  _input: PetVideoInput,
  _config: SimpleVideoConfig,
  _options: PetVideoOptions,
  _services: PetVideoServices,
): Promise<PetVideoResult> {
  throw new Error('视频能力正在迁移到千问，暂时不可用。');
}

export async function runIpVideoCreation(
  _input: { copyText: string },
  _config: IpVideoConfig,
  _context: IpVideoContext,
  _options: IpVideoOptions,
  _services: IpVideoServices,
): Promise<IpVideoResult> {
  throw new Error('视频能力正在迁移到千问，暂时不可用。');
}

/** Production-safe boundary for the not-yet-migrated audio/video verifier. */
export async function verifyAudioVisualSync(
  input: VerifyAudioVisualSyncInput,
  _deps?: VideoAvSyncVerifierDeps,
): Promise<VideoAvSyncReview> {
  return {
    status: 'unknown',
    reason: '音画同步复核正在迁移到千问，暂时不可用。',
    evidence: [],
    model: input.model ?? 'qwen-migration-pending',
  };
}
