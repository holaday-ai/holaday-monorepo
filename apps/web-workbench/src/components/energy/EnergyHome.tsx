import { type AstroProfile, defaultAstroProfile, readAstroProfile } from '@/lib/astrology';
import { trpc } from '@/lib/trpc';
import * as React from 'react';
import { AstrologyWorld } from './AstrologyWorld';
import { EnergyAstrologyPanel } from './EnergyAstrologyPanel';
import { EnergyExperienceDeck } from './EnergyExperienceDeck';
import { EnergyGrowthPanel } from './EnergyGrowthPanel';
import { EnergyHero } from './EnergyHero';
import { EnergyProfileDrawer } from './EnergyProfileDrawer';
import { ExperiencePlayer } from './ExperiencePlayer';
import { readEnergyProgress, recordEnergyCompletion } from './energy-progress';
import type { EnergyExperienceId, EnergyNeed, ExperiencePhase } from './energy-types';
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
  const [energyNeed, setEnergyNeed] = React.useState<EnergyNeed>('focus');
  const [progress, setProgress] = React.useState(() => readEnergyProgress(storageScope));
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
  const profileTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const astrologyWorldRef = React.useRef<HTMLElement | null>(null);
  const startedAtRef = React.useRef(Date.now());
  const astrology = useEnergyAstrology(profile, liveProvider);
  const LoadedExperience = React.useMemo(
    () => (selectedExperience?.load ? React.lazy(selectedExperience.load) : null),
    [selectedExperience?.load],
  );

  React.useEffect(() => {
    setProfile(
      canUseProfileStorage
        ? (readAstroProfile(storageScope) ?? defaultAstroProfile())
        : defaultAstroProfile(),
    );
    setProgress(readEnergyProgress(storageScope));
  }, [canUseProfileStorage, storageScope]);

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

  const recharge = experiences.find((experience) => experience.id === 'recharge') ?? null;
  const tarot = experiences.find((experience) => experience.id === 'tarot') ?? null;
  const lightTest = experiences.find((experience) => experience.id === 'light-test') ?? null;

  return (
    <div className="energy-page" data-profile-scope={profileStorageScope ? 'user' : 'guest'}>
      <EnergyHero
        value={energyNeed}
        onChange={setEnergyNeed}
        onStart={(need, trigger) => {
          if (!recharge || recharge.status !== 'active' || !recharge.actionable) return;
          setEnergyNeed(need);
          openExperience(recharge, trigger);
        }}
      />

      <EnergyExperienceDeck experiences={experiences} onOpen={openExperience} />

      <div className="energy-insight-grid">
        <EnergyGrowthPanel progress={progress} />
        <EnergyAstrologyPanel
          profile={profile}
          astrology={astrology}
          canEditProfile={canUseProfileStorage}
          onOpen={() => {
            astrologyWorldRef.current?.scrollIntoView?.({
              behavior: prefersReducedMotion() ? 'auto' : 'smooth',
              block: 'start',
            });
          }}
          onEditProfile={(trigger) => {
            profileTriggerRef.current = trigger;
            setProfileOpen(true);
          }}
        />
      </div>

      <AstrologyWorld
        ref={astrologyWorldRef}
        astrology={astrology}
        onOpenEnergyCard={(trigger) => {
          if (!tarot || tarot.status !== 'active' || !tarot.actionable) return;
          openExperience(tarot, trigger);
        }}
        onOpenLightTest={(trigger) => {
          if (!lightTest || lightTest.status !== 'active' || !lightTest.actionable) return;
          openExperience(lightTest, trigger);
        }}
      />

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
        replayLabel={selectedExperience?.replayLabel}
      >
        {LoadedExperience ? (
          <React.Suspense
            fallback={<div className="energy-experience-placeholder">正在打开体验…</div>}
          >
            <LoadedExperience
              mood={null}
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

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
