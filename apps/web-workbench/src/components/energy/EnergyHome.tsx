import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc';
import { Clock3, FlaskConical, Gamepad2, MoonStar, Star, UserRound } from 'lucide-react';
import * as React from 'react';
import { ExperiencePlayer } from './ExperiencePlayer';
import { MoodCheckIn } from './MoodCheckIn';
import { energyResponseForMood, recommendExperience } from './energy-recommendation';
import type {
  EnergyExperienceDefinition,
  EnergyExperienceId,
  EnergyMood,
  ExperiencePhase,
} from './energy-types';
import { ENERGY_EXPERIENCES } from './experience-registry';
import './energy.css';

interface EnergyHomeProps {
  profileStorageScope: string | null;
}

type EnergyEventType = 'started' | 'completed' | 'replayed' | 'failed';
type EnergyEventOutcome = 'success' | 'abandoned' | 'error' | null;

const MODE_ICONS = {
  tarot: MoonStar,
  'light-test': FlaskConical,
  horoscope: Star,
  games: Gamepad2,
} satisfies Record<EnergyExperienceId, React.ComponentType<{ className?: string }>>;

function localExperiences(): EnergyExperienceDefinition[] {
  return ENERGY_EXPERIENCES.map((experience) => ({
    ...experience,
    requiredProfileFields: [...experience.requiredProfileFields],
  }));
}

export function EnergyHome({ profileStorageScope }: EnergyHomeProps): JSX.Element {
  const [mood, setMood] = React.useState<EnergyMood | null>(null);
  const [experiences, setExperiences] = React.useState(localExperiences);
  const [selectedExperience, setSelectedExperience] =
    React.useState<EnergyExperienceDefinition | null>(null);
  const [phase, setPhase] = React.useState<ExperiencePhase>('intro');
  const returnFocusRef = React.useRef<HTMLButtonElement | null>(null);

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
    ) => {
      void trpc.energy.reportEvent
        .mutate({
          type,
          experienceId,
          mood,
          durationBucket: null,
          outcome,
        })
        .catch(() => console.warn('energy event report failed'));
    },
    [mood],
  );

  const preferredRecommendation = recommendExperience(mood ?? 'tired');
  const recommendation =
    experiences.find(
      (experience) =>
        experience.id === preferredRecommendation.id &&
        experience.status === 'active' &&
        experience.actionable,
    ) ?? experiences.find((experience) => experience.status === 'active' && experience.actionable);
  const response = mood ? energyResponseForMood(mood) : null;

  const openExperience = (
    experience: EnergyExperienceDefinition,
    trigger: HTMLButtonElement,
  ): void => {
    returnFocusRef.current = trigger;
    setSelectedExperience(experience);
    setPhase('intro');
    reportEvent('started', experience.id);
  };

  return (
    <div className="energy-page" data-profile-scope={profileStorageScope ? 'user' : 'guest'}>
      <section className="energy-check-in" aria-labelledby="energy-check-in-title">
        <div className="energy-section-heading">
          <p>先停半分钟</p>
          <h2 id="energy-check-in-title">你现在感觉怎么样？</h2>
          <span>不用解释，选最接近此刻的一项。</span>
        </div>
        <MoodCheckIn value={mood} onChange={setMood} />
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
            className="energy-recommendation__action"
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
          {experiences.map((experience) => {
            const Icon = MODE_ICONS[experience.id];
            const available = experience.status === 'active' && experience.actionable;
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
                    onClick={(event) => openExperience(experience, event.currentTarget)}
                  >
                    打开{experience.title}
                    <span>
                      <Clock3 aria-hidden="true" /> {experience.estimatedSeconds} 秒
                    </span>
                  </button>
                ) : (
                  <p className="energy-mode-card__coming">小游戏正在准备中</p>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <details className="energy-profile-entry">
        <summary>
          <span className="energy-profile-entry__icon" aria-hidden="true">
            <UserRound />
          </span>
          <span>
            <strong>我的能量</strong>
            <small>星座体验需要时，再补充你的资料</small>
          </span>
        </summary>
        <p className="energy-detail-copy">
          资料只保存在当前账号的本地空间，用于生成星座节奏；你可以随时查看或清除。
        </p>
      </details>

      <ExperiencePlayer
        open={selectedExperience !== null}
        experience={selectedExperience}
        phase={phase}
        returnFocusRef={returnFocusRef}
        onClose={() => setSelectedExperience(null)}
        onStart={() => setPhase('active')}
        onReplay={() => {
          if (selectedExperience) reportEvent('replayed', selectedExperience.id);
          setPhase('active');
        }}
        onChooseAnother={() => setSelectedExperience(null)}
      >
        <div className="energy-experience-placeholder">
          <h3>慢慢来，玩法马上开始</h3>
          <p>这里会承载抽卡、轻测试和今日星座的完整互动。</p>
        </div>
      </ExperiencePlayer>
    </div>
  );
}
