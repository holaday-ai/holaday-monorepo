import { type AstroProfile, defaultAstroProfile, readAstroProfile } from '@/lib/astrology';
import { trpc } from '@/lib/trpc';
import type { UiTask } from '@/types/task';
import * as React from 'react';
import { AstrologyWorld, type AstrologyWorldHandle } from './AstrologyWorld';
import { EnergyAstrologyPanel } from './EnergyAstrologyPanel';
import { EnergyExperienceDeck } from './EnergyExperienceDeck';
import { type EnergyExploreEvent, EnergyExploreFeed } from './EnergyExploreFeed';
import { EnergyGrowthPanel } from './EnergyGrowthPanel';
import { EnergyHero } from './EnergyHero';
import { EnergyProfileDrawer } from './EnergyProfileDrawer';
import { ENERGY_SECTION_LINKS, type EnergySectionId, EnergySectionNav } from './EnergySectionNav';
import { EnergyShelf } from './EnergyShelf';
import { ExperiencePlayer } from './ExperiencePlayer';
import { RunningTaskDock, type RunningTaskDockEvent } from './RunningTaskDock';
import { resolveEnergyContentTarget } from './content-target-controller';
import type { EnergyContentTarget, EnergyExperienceLaunchTarget } from './energy-content-target';
import { recommendNextEnergyTarget } from './energy-continuation';
import { createEnergyEventReporter } from './energy-event-reporter';
import {
  completedKindsForDate,
  readEnergyProgress,
  recordCompletedEnergyExperience,
  removeSavedEnergyCard,
  removeSavedLightTestAction,
  toggleFavoriteEnergyContent,
} from './energy-progress';
import { type EnergyShelfItem, buildEnergyShelfModel } from './energy-shelf';
import type { EnergyExperienceId, EnergyNeed, ExperiencePhase } from './energy-types';
import { ENERGY_EXPERIENCES, type EnergyExperienceRegistration } from './experience-registry';
import { useEnergyAstrology } from './useEnergyAstrology';
import './energy.css';

interface EnergyHomeProps {
  profileStorageScope: string | null;
  liveProvider?: boolean;
  tasks?: readonly UiTask[];
}

type EnergyEventType =
  | 'energy_experience_started'
  | 'energy_experience_completed'
  | 'energy_experience_failed';
type EnergyEventOutcome = 'success' | 'abandoned' | 'error' | null;
type EnergyDurationBucket = 'under-60s' | 'one-to-three-minutes' | 'over-three-minutes' | null;
type EnergyModeId =
  | Extract<EnergyExperienceLaunchTarget, { type: 'practice' }>['practiceId']
  | Extract<EnergyExperienceLaunchTarget, { type: 'poll' }>['pollId']
  | Extract<EnergyExperienceLaunchTarget, { type: 'test' }>['testId']
  | Extract<EnergyExperienceLaunchTarget, { type: 'tarot' }>['mode']
  | Extract<EnergyExperienceLaunchTarget, { type: 'game' }>['gameId'];

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
  tasks = [],
}: EnergyHomeProps): JSX.Element {
  const storageScope = profileStorageScope?.trim() || null;
  const canUseProfileStorage = !liveProvider || Boolean(storageScope);
  const [energyNeed, setEnergyNeed] = React.useState<EnergyNeed>('focus');
  const [progress, setProgress] = React.useState(() => readEnergyProgress(storageScope));
  const [experiences, setExperiences] = React.useState(localExperiences);
  const [selectedExperience, setSelectedExperience] =
    React.useState<EnergyExperienceRegistration | null>(null);
  const [selectedLaunchTarget, setSelectedLaunchTarget] =
    React.useState<EnergyExperienceLaunchTarget | null>(null);
  const [phase, setPhase] = React.useState<ExperiencePhase>('intro');
  const [profile, setProfile] = React.useState<AstroProfile>(() =>
    canUseProfileStorage
      ? (readAstroProfile(storageScope) ?? defaultAstroProfile())
      : defaultAstroProfile(),
  );
  const [profileOpen, setProfileOpen] = React.useState(false);
  const returnFocusRef = React.useRef<HTMLButtonElement | null>(null);
  const profileTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const astrologyWorldRef = React.useRef<AstrologyWorldHandle | null>(null);
  const todayContentRef = React.useRef<HTMLDivElement | null>(null);
  const growthRef = React.useRef<HTMLDivElement | null>(null);
  const startedAtRef = React.useRef(Date.now());
  const astrology = useEnergyAstrology(profile, liveProvider);
  const LoadedExperience = React.useMemo(
    () => (selectedExperience?.load ? React.lazy(selectedExperience.load) : null),
    [selectedExperience?.load],
  );
  const eventReporter = React.useMemo(
    () =>
      createEnergyEventReporter({
        send: (event: Parameters<typeof trpc.energy.reportEvent.mutate>[0]) =>
          trpc.energy.reportEvent.mutate(event),
      }),
    [],
  );

  React.useEffect(() => () => eventReporter.dispose(), [eventReporter]);

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
      launchTarget: EnergyExperienceLaunchTarget | null,
      outcome: EnergyEventOutcome = null,
      eventDurationBucket: EnergyDurationBucket = null,
    ) => {
      void eventReporter.report({
        type,
        experienceId,
        modeId: modeIdForExperience(experienceId, launchTarget),
        energyNeed,
        durationBucket: eventDurationBucket,
        outcome,
      });
    },
    [energyNeed, eventReporter],
  );

  const reportHubEvent = React.useCallback(
    (event: EnergyExploreEvent | RunningTaskDockEvent) => {
      void eventReporter.report(event);
    },
    [eventReporter],
  );

  const openExperience = (
    experience: EnergyExperienceRegistration,
    trigger: HTMLButtonElement,
    launchTarget: EnergyExperienceLaunchTarget | null = null,
    preserveReturnFocus = false,
  ): boolean => {
    if (experience.status !== 'active' || !experience.actionable || !experience.load) return false;
    if (!preserveReturnFocus) returnFocusRef.current = trigger;
    setSelectedExperience(experience);
    setSelectedLaunchTarget(launchTarget);
    setPhase('intro');
    return true;
  };

  const handlePhaseChange = (nextPhase: ExperiencePhase): void => {
    if (selectedExperience && nextPhase === 'result' && phase !== 'result') {
      reportEvent(
        'energy_experience_completed',
        selectedExperience.id,
        selectedLaunchTarget,
        'success',
        durationBucket(startedAtRef.current),
      );
    }
    if (selectedExperience && nextPhase === 'error' && phase !== 'error') {
      reportEvent(
        'energy_experience_failed',
        selectedExperience.id,
        selectedLaunchTarget,
        'error',
        durationBucket(startedAtRef.current),
      );
    }
    setPhase(nextPhase);
  };

  const recharge = experiences.find((experience) => experience.id === 'recharge') ?? null;
  const tarot = experiences.find((experience) => experience.id === 'tarot') ?? null;
  const lightTest = experiences.find((experience) => experience.id === 'light-test') ?? null;
  const completedToday = completedKindsForDate(progress);
  const shelfModel = React.useMemo(
    () => buildEnergyShelfModel(progress, profile.zodiacSign),
    [progress, profile.zodiacSign],
  );
  const continuation = recommendNextEnergyTarget({
    energyNeed,
    completedKinds: completedToday,
    lastCompletedKind: progress.continuation.lastCompletedKind,
    unavailableTypes: unavailableContinuationTypes(experiences),
  });

  const executeTarget = (target: EnergyContentTarget, trigger: HTMLButtonElement): boolean => {
    const command = resolveEnergyContentTarget(target);
    if (command.type === 'astrology') {
      setSelectedExperience(null);
      astrologyWorldRef.current?.openPeriod(command.period);
      astrologyWorldRef.current?.scrollIntoView?.({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'start',
      });
      return Boolean(astrologyWorldRef.current);
    }
    if (command.type === 'astrology-signs') {
      setSelectedExperience(null);
      astrologyWorldRef.current?.openSigns();
      astrologyWorldRef.current?.scrollIntoView?.({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'start',
      });
      return Boolean(astrologyWorldRef.current);
    }
    const experience = experiences.find((item) => item.id === command.experienceId);
    if (
      !experience ||
      experience.status !== 'active' ||
      !experience.actionable ||
      !experience.load
    ) {
      return false;
    }
    openExperience(experience, trigger, command.launchTarget);
    return true;
  };

  const openShelfItem = (item: EnergyShelfItem, trigger: HTMLButtonElement): boolean => {
    if (item.recent) {
      const experience = experiences.find(
        (candidate) => candidate.id === item.recent?.experienceId,
      );
      return experience ? openExperience(experience, trigger, item.recent.launchTarget) : false;
    }
    return item.target ? executeTarget(item.target, trigger) : false;
  };

  const removeShelfFavorite = (item: EnergyShelfItem): void => {
    const favorite = item.favoriteRef;
    if (!favorite) return;
    if (favorite.source === 'energy-card') {
      setProgress(removeSavedEnergyCard(storageScope, favorite.cardId));
      return;
    }
    if (favorite.source === 'test-action') {
      setProgress(removeSavedLightTestAction(storageScope, favorite.testId, favorite.outcomeId));
      return;
    }
    setProgress(toggleFavoriteEnergyContent(storageScope, favorite.contentId));
  };

  const canOpenLastTarget = progress.continuation.lastTarget
    ? targetIsAvailable(progress.continuation.lastTarget, experiences)
    : false;

  return (
    <div className="energy-page" data-profile-scope={profileStorageScope ? 'user' : 'guest'}>
      <div id="energy-recharge" className="energy-section-anchor">
        <EnergyHero
          mode={completedToday.length > 0 ? 'compact' : 'full'}
          value={energyNeed}
          completedCount={completedToday.length}
          totalCount={5}
          continueLabel={canOpenLastTarget ? '继续上次' : '继续今日内容'}
          onChange={setEnergyNeed}
          onContinue={(trigger) => {
            if (
              canOpenLastTarget &&
              progress.continuation.lastTarget &&
              executeTarget(progress.continuation.lastTarget, trigger)
            ) {
              return;
            }
            todayContentRef.current?.scrollIntoView?.({
              behavior: prefersReducedMotion() ? 'auto' : 'smooth',
              block: 'start',
            });
          }}
          onStart={(need, trigger) => {
            if (!recharge || recharge.status !== 'active' || !recharge.actionable) return;
            setEnergyNeed(need);
            openExperience(recharge, trigger);
          }}
        />
      </div>

      <EnergySectionNav
        sections={ENERGY_SECTION_LINKS}
        onNavigate={(sectionId) => {
          void eventReporter.report({
            type: 'energy_section_navigated',
            section: analyticsSection(sectionId),
          });
        }}
      />

      <div id="energy-play" className="energy-section-anchor">
        <EnergyExperienceDeck experiences={experiences} onOpen={openExperience} />
      </div>

      <div id="energy-growth" ref={growthRef} className="energy-insight-grid">
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

      <div
        id="energy-today-content"
        ref={todayContentRef}
        className="energy-section-anchor"
        tabIndex={-1}
      >
        <EnergyExploreFeed
          key={storageScope ?? 'preview'}
          storageScope={storageScope}
          mood={null}
          energyNeed={energyNeed}
          zodiacSign={profile.zodiacSign}
          favoriteContentIds={progress.continuation.favoriteContentIds}
          onEvent={reportHubEvent}
          onActionTarget={executeTarget}
          onProgressChange={setProgress}
          onCompleteToday={() => {
            growthRef.current?.scrollIntoView?.({
              behavior: prefersReducedMotion() ? 'auto' : 'smooth',
              block: 'start',
            });
          }}
        />
      </div>

      <EnergyShelf
        model={shelfModel}
        onOpen={openShelfItem}
        onRemoveFavorite={removeShelfFavorite}
      />

      {tasks.length > 0 ? <RunningTaskDock tasks={tasks} onEvent={reportHubEvent} /> : null}

      <ExperiencePlayer
        open={selectedExperience !== null}
        experience={selectedExperience}
        phase={phase}
        returnFocusRef={returnFocusRef}
        onClose={() => setSelectedExperience(null)}
        onStart={() => {
          if (!selectedExperience) return;
          startedAtRef.current = Date.now();
          reportEvent('energy_experience_started', selectedExperience.id, selectedLaunchTarget);
          handlePhaseChange('active');
        }}
        onReplay={() => {
          if (selectedExperience) {
            reportEvent('energy_experience_started', selectedExperience.id, selectedLaunchTarget);
          }
          startedAtRef.current = Date.now();
          handlePhaseChange('active');
        }}
        onChooseAnother={() => setSelectedExperience(null)}
        replayLabel={selectedExperience?.replayLabel}
        continuation={continuation}
        onContinue={(trigger) => {
          if (!continuation) return;
          const command = resolveEnergyContentTarget(continuation.target);
          const experience =
            command.type === 'experience'
              ? experiences.find((item) => item.id === command.experienceId)
              : null;
          const opened =
            command.type === 'experience' && experience
              ? openExperience(experience, trigger, command.launchTarget, true)
              : executeTarget(continuation.target, trigger);
          if (opened) {
            void eventReporter.report({
              type: 'energy_continuation_opened',
              fromKind: progress.continuation.lastCompletedKind,
              targetType: continuation.target.type,
            });
          }
        }}
        onReturnToContent={() => {
          returnFocusRef.current = null;
          setSelectedExperience(null);
          window.requestAnimationFrame(() => {
            todayContentRef.current?.scrollIntoView?.({
              behavior: prefersReducedMotion() ? 'auto' : 'smooth',
              block: 'start',
            });
            todayContentRef.current?.focus();
          });
        }}
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
              launchTarget={selectedLaunchTarget}
              phase={phase}
              onPhaseChange={handlePhaseChange}
              onExperienceComplete={(kind) => {
                if (!selectedExperience || selectedExperience.id === 'poll') return;
                setProgress(
                  recordCompletedEnergyExperience(storageScope, {
                    experienceId: selectedExperience.id,
                    launchTarget: selectedLaunchTarget,
                    kind,
                  }),
                );
              }}
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

function analyticsSection(
  sectionId: EnergySectionId,
): 'recharge' | 'play' | 'astrology' | 'today-content' {
  if (sectionId === 'energy-recharge') return 'recharge';
  if (sectionId === 'energy-play') return 'play';
  if (sectionId === 'energy-astrology-world') return 'astrology';
  return 'today-content';
}

function targetIsAvailable(
  target: EnergyContentTarget,
  experiences: readonly EnergyExperienceRegistration[],
): boolean {
  const command = resolveEnergyContentTarget(target);
  if (command.type !== 'experience') return true;
  const experience = experiences.find((item) => item.id === command.experienceId);
  return Boolean(experience?.status === 'active' && experience.actionable && experience.load);
}

function unavailableContinuationTypes(
  experiences: readonly EnergyExperienceRegistration[],
): EnergyContentTarget['type'][] {
  const types: EnergyContentTarget['type'][] = [];
  if (!experienceIsAvailable('practice', experiences)) types.push('practice');
  if (!experienceIsAvailable('light-test', experiences)) types.push('test');
  if (!experienceIsAvailable('games', experiences)) types.push('game');
  if (!experienceIsAvailable('tarot', experiences)) types.push('tarot');
  if (!experienceIsAvailable('horoscope', experiences)) types.push('astrology');
  return types;
}

function experienceIsAvailable(
  id: EnergyExperienceId,
  experiences: readonly EnergyExperienceRegistration[],
): boolean {
  const experience = experiences.find((item) => item.id === id);
  return Boolean(experience?.status === 'active' && experience.actionable && experience.load);
}

function modeIdForExperience(
  experienceId: EnergyExperienceId,
  launchTarget: EnergyExperienceLaunchTarget | null,
): EnergyModeId | null {
  if (launchTarget?.type === 'practice') return launchTarget.practiceId;
  if (launchTarget?.type === 'poll') return launchTarget.pollId;
  if (launchTarget?.type === 'test') return launchTarget.testId;
  if (launchTarget?.type === 'tarot') return launchTarget.mode;
  if (launchTarget?.type === 'game') return launchTarget.gameId;
  return experienceId === 'games' ? 'catch-energy' : null;
}
