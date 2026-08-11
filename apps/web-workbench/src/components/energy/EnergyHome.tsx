import { Button } from '@/components/ui/button';
import { type AstroProfile, defaultAstroProfile, readAstroProfile } from '@/lib/astrology';
import { trpc } from '@/lib/trpc';
import { Clock3, FlaskConical, Gamepad2, MoonStar, Star, UserRound, Zap } from 'lucide-react';
import * as React from 'react';
import { EnergyHero } from './EnergyHero';
import { EnergyProfileDrawer } from './EnergyProfileDrawer';
import { ExperiencePlayer } from './ExperiencePlayer';
import { MoodCheckIn } from './MoodCheckIn';
import { readEnergyProgress, recordEnergyCompletion } from './energy-progress';
import { energyResponseForMood, recommendExperience } from './energy-recommendation';
import type { EnergyExperienceId, EnergyMood, EnergyNeed, ExperiencePhase } from './energy-types';
import { ENERGY_EXPERIENCES, type EnergyExperienceRegistration } from './experience-registry';
import { useEnergyAstrology } from './useEnergyAstrology';
import './energy.css';

interface EnergyHomeProps {
  profileStorageScope: string | null;
  liveProvider?: boolean;
}

type EnergyEventType = 'started' | 'completed' | 'replayed' | 'failed';
type EnergyEventOutcome = 'success' | 'abandoned' | 'error' | null;
type EnergyDurationBucket = 'under-60s' | 'one-to-three-minutes' | 'over-three-minutes' | null;

const MODE_ICONS = {
  recharge: Zap,
  tarot: MoonStar,
  'light-test': FlaskConical,
  horoscope: Star,
  games: Gamepad2,
} satisfies Record<EnergyExperienceId, React.ComponentType<{ className?: string }>>;

function energyNeedForMood(mood: EnergyMood | null): EnergyNeed {
  if (mood === 'tired' || mood === 'stressed') return 'relax';
  if (mood === 'good') return 'uplift';
  if (mood === 'unwind') return 'confidence';
  return 'focus';
}

function localExperiences(): EnergyExperienceRegistration[] {
  return ENERGY_EXPERIENCES.map((experience) => ({
    ...experience,
    requiredProfileFields: [...experience.requiredProfileFields],
  }));
}

function durationBucket(startedAt: number): Exclude<EnergyDurationBucket, null> {
  const seconds = Math.max(0, (Date.now() - startedAt) / 1000);
  if (seconds < 60) return 'under-60s';
  if (seconds <= 180) return 'one-to-three-minutes';
  return 'over-three-minutes';
}

export function EnergyHome({
  profileStorageScope,
  liveProvider = false,
}: EnergyHomeProps): JSX.Element {
  const storageScope = profileStorageScope?.trim() || null;
  const canUseProfileStorage = !liveProvider || Boolean(storageScope);
  const [mood, setMood] = React.useState<EnergyMood | null>(null);
  const [energyNeed, setEnergyNeed] = React.useState<EnergyNeed>('focus');
  const [, setProgress] = React.useState(() => readEnergyProgress(storageScope));
  const [experiences, setExperiences] = React.useState(localExperiences);
  const [selectedExperience, setSelectedExperience] =
    React.useState<EnergyExperienceRegistration | null>(null);
  const [phase, setPhase] = React.useState<ExperiencePhase>('intro');
  const [profile, setProfile] = React.useState<AstroProfile>(() =>
    canUseProfileStorage
      ? (readAstroProfile(storageScope) ?? defaultAstroProfile())
      : defaultAstroProfile(),
  );
  const [profileOpen, setProfileOpen] = React.useState(false);
  const returnFocusRef = React.useRef<HTMLButtonElement | null>(null);
  const profileTriggerRef = React.useRef<HTMLButtonElement>(null);
  const startedAtRef = React.useRef(Date.now());
  const astrology = useEnergyAstrology(profile, liveProvider);
  const LoadedExperience = React.useMemo(() => {
    return selectedExperience?.load ? React.lazy(selectedExperience.load) : null;
  }, [selectedExperience?.load]);

  React.useEffect(() => {
    setProfile(
      canUseProfileStorage
        ? (readAstroProfile(storageScope) ?? defaultAstroProfile())
        : defaultAstroProfile(),
    );
  }, [canUseProfileStorage, storageScope]);

  React.useEffect(() => {
    setProgress(readEnergyProgress(storageScope));
  }, [storageScope]);

  React.useEffect(() => {
    let active = true;
    void trpc.energy.home
      .query()
      .then((home) => {
        if (!active) return;
        setExperiences((current) =>
          current.map((local) => {
            const remote = home.experiences.find((item) => item.id === local.id);
            return remote ? { ...local, ...remote } : local;
          }),
        );
      })
      .catch(() => {
        // The local registry is the offline-safe catalog.
      });
    return () => {
      active = false;
    };
  }, []);

  const reportEvent = React.useCallback(
    (
      type: EnergyEventType,
      experienceId: EnergyExperienceId,
      outcome: EnergyEventOutcome = null,
      eventDurationBucket: EnergyDurationBucket = null,
    ) => {
      void trpc.energy.reportEvent
        .mutate({
          type,
          experienceId,
          energyNeed,
          durationBucket: eventDurationBucket,
          outcome,
        })
        .catch(() => console.warn('energy event report failed'));
    },
    [energyNeed],
  );

  const preferredRecommendation = recommendExperience(mood ?? 'tired');
  const recommendation =
    experiences.find(
      (experience) =>
        experience.id === preferredRecommendation.id &&
        experience.status === 'active' &&
        experience.actionable &&
        Boolean(experience.load),
    ) ??
    experiences.find(
      (experience) =>
        experience.status === 'active' && experience.actionable && Boolean(experience.load),
    );
  const response = mood ? energyResponseForMood(mood) : null;

  const openExperience = (
    experience: EnergyExperienceRegistration,
    trigger: HTMLButtonElement,
  ): void => {
    if (!experience.load) return;
    returnFocusRef.current = trigger;
    startedAtRef.current = Date.now();
    setSelectedExperience(experience);
    setPhase('intro');
    reportEvent('started', experience.id);
  };

  const handlePhaseChange = (nextPhase: ExperiencePhase): void => {
    if (selectedExperience && nextPhase === 'result' && phase !== 'result') {
      reportEvent(
        'completed',
        selectedExperience.id,
        'success',
        durationBucket(startedAtRef.current),
      );
    }
    if (selectedExperience && nextPhase === 'error' && phase !== 'error') {
      reportEvent('failed', selectedExperience.id, 'error', durationBucket(startedAtRef.current));
    }
    setPhase(nextPhase);
  };

  return (
    <div className="energy-page" data-profile-scope={profileStorageScope ? 'user' : 'guest'}>
      <EnergyHero
        value={energyNeed}
        onChange={setEnergyNeed}
        onStart={(need, trigger) => {
          const recharge = experiences.find(
            (experience) =>
              experience.id === 'recharge' &&
              experience.status === 'active' &&
              experience.actionable &&
              Boolean(experience.load),
          );
          if (!recharge) return;
          setEnergyNeed(need);
          openExperience(recharge, trigger);
        }}
      />

      <section className="energy-check-in" aria-labelledby="energy-check-in-title">
        <div className="energy-section-heading">
          <p>先停半分钟</p>
          <h2 id="energy-check-in-title">你现在感觉怎么样？</h2>
          <span>不用解释，选最接近此刻的一项。</span>
        </div>
        <MoodCheckIn
          value={mood}
          onChange={(nextMood) => {
            setMood(nextMood);
            setEnergyNeed(energyNeedForMood(nextMood));
          }}
        />
      </section>

      <section className="energy-recommendation" aria-labelledby="energy-recommendation-title">
        <div className="energy-recommendation__copy" aria-live="polite">
          <p>{mood ? '给现在的你' : '今天的轻提示'}</p>
          <h2 id="energy-recommendation-title">{response?.title ?? '先从一张轻提示开始'}</h2>
          <span className="energy-detail-copy">
            {response?.body ?? '不需要准备，也没有标准答案。让这几十秒只属于你。'}
          </span>
        </div>
        {recommendation ? (
          <Button
            type="button"
            size="lg"
            className="energy-recommendation__action min-h-11"
            onClick={(event) => openExperience(recommendation, event.currentTarget)}
          >
            {response?.action ?? '抽一张卡'}
          </Button>
        ) : null}
      </section>

      <section className="energy-modes" aria-labelledby="energy-modes-title">
        <div className="energy-section-heading energy-section-heading--row">
          <div>
            <p>换一种方式</p>
            <h2 id="energy-modes-title">轻松一点的几分钟</h2>
          </div>
          <span>所有体验都可以随时退出。</span>
        </div>
        <div className="energy-mode-grid">
          {experiences
            .filter((experience) => experience.id !== 'recharge')
            .map((experience) => {
              const Icon = MODE_ICONS[experience.id];
              const available =
                experience.status === 'active' && experience.actionable && Boolean(experience.load);
              return (
                <article
                  key={experience.id}
                  className="energy-mode-card"
                  data-status={experience.status}
                >
                  <span className="energy-mode-card__icon" aria-hidden="true">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <h3>{experience.title}</h3>
                    <p>{experience.description}</p>
                  </div>
                  {available ? (
                    <button
                      type="button"
                      className="min-h-11"
                      onClick={(event) => openExperience(experience, event.currentTarget)}
                    >
                      打开{experience.title}
                      <span>
                        <Clock3 aria-hidden="true" /> {experience.estimatedSeconds} 秒
                      </span>
                    </button>
                  ) : (
                    <p className="energy-mode-card__coming">这个体验暂时不可用</p>
                  )}
                </article>
              );
            })}
        </div>
      </section>

      <section className="energy-profile-entry">
        <button
          ref={profileTriggerRef}
          type="button"
          className="energy-profile-entry__button"
          disabled={!canUseProfileStorage}
          onClick={() => setProfileOpen(true)}
        >
          <span className="energy-profile-entry__icon" aria-hidden="true">
            <UserRound />
          </span>
          <span>
            <strong>我的能量</strong>
            <small>星座体验需要时，再补充你的资料</small>
          </span>
        </button>
        <p className="energy-detail-copy">
          资料只保存在当前账号的本地空间，用于生成星座节奏；你可以随时查看或清除。
        </p>
      </section>

      <ExperiencePlayer
        open={selectedExperience !== null}
        experience={selectedExperience}
        phase={phase}
        returnFocusRef={returnFocusRef}
        onClose={() => setSelectedExperience(null)}
        onStart={() => handlePhaseChange('active')}
        onReplay={() => {
          if (selectedExperience) reportEvent('replayed', selectedExperience.id);
          startedAtRef.current = Date.now();
          handlePhaseChange('active');
        }}
        onChooseAnother={() => setSelectedExperience(null)}
      >
        {LoadedExperience ? (
          <React.Suspense
            fallback={<div className="energy-experience-placeholder">正在打开体验…</div>}
          >
            <LoadedExperience
              mood={mood}
              energyNeed={energyNeed}
              profileStorageScope={storageScope}
              profile={profile}
              astrology={astrology}
              phase={phase}
              onPhaseChange={handlePhaseChange}
              onExperienceComplete={(kind) =>
                setProgress(recordEnergyCompletion(storageScope, kind))
              }
            />
          </React.Suspense>
        ) : null}
      </ExperiencePlayer>

      <EnergyProfileDrawer
        open={profileOpen}
        storageScope={storageScope}
        returnFocusRef={profileTriggerRef}
        onOpenChange={setProfileOpen}
        onProfileChange={(nextProfile) => setProfile(nextProfile ?? defaultAstroProfile())}
      />
    </div>
  );
}
