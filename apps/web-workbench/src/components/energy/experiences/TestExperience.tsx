import { Button } from '@/components/ui/button';
import { Activity, BriefcaseBusiness, HandHeart, Hash, HeartPulse, Users } from 'lucide-react';
import * as React from 'react';
import {
  readEnergyProgress,
  recordLightTestCompletion,
  saveLightTestAction,
} from '../energy-progress';
import type { ExperiencePhase } from '../energy-types';
import { scoreLightTest } from './light-test-engine';
import {
  LIGHT_TESTS,
  type LightTestCategory,
  type LightTestDefinition,
  type LightTestId,
  type LightTestOutcome,
} from './test-content';

interface TestExperienceProps {
  profileStorageScope: string | null;
  initialTestId?: LightTestId;
  phase: ExperiencePhase;
  onPhaseChange: (phase: ExperiencePhase) => void;
  onComplete?: () => void;
}

const TEST_ICONS = {
  emotion: HeartPulse,
  stress: Activity,
  work: BriefcaseBusiness,
  relationship: HandHeart,
  social: Users,
  'daily-number': Hash,
} satisfies Record<LightTestCategory, React.ComponentType<{ className?: string }>>;

const RESULT_LABELS = {
  emotion: '今日心理画像',
  stress: '今日压力提示',
  work: '今日工作提示',
  relationship: '今日关系提示',
  social: '今日社交提示',
  'daily-number': '今日数字提示',
} satisfies Record<LightTestCategory, string>;

const CATEGORY_LABELS = {
  emotion: '情绪与恢复',
  stress: '压力与节奏',
  work: '工作与专注',
  relationship: '关系与表达',
  social: '社交与边界',
  'daily-number': '今日行动数字',
} satisfies Record<LightTestCategory, string>;

const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as LightTestCategory[];

export function TestExperience({
  profileStorageScope,
  initialTestId,
  phase,
  onPhaseChange,
  onComplete = () => undefined,
}: TestExperienceProps): JSX.Element {
  const [stage, setStage] = React.useState<'directory' | 'questions' | 'result'>(() =>
    initialTestId ? 'questions' : 'directory',
  );
  const [activeTestId, setActiveTestId] = React.useState<LightTestId | null>(
    initialTestId ?? null,
  );
  const [questionIndex, setQuestionIndex] = React.useState(0);
  const [answers, setAnswers] = React.useState<string[]>([]);
  const [result, setResult] = React.useState<LightTestOutcome | null>(null);
  const [completedTestIds, setCompletedTestIds] = React.useState<string[]>(
    () => readEnergyProgress(profileStorageScope).completedTestIds,
  );
  const [savedAction, setSavedAction] = React.useState(false);
  const previousPhaseRef = React.useRef(phase);
  const internalResumeRef = React.useRef(false);
  const initialTestRef = React.useRef(initialTestId);

  React.useEffect(() => {
    if (!initialTestId || initialTestRef.current === initialTestId) return;
    initialTestRef.current = initialTestId;
    setActiveTestId(initialTestId);
    setStage('questions');
    setQuestionIndex(0);
    setAnswers([]);
    setResult(null);
    setSavedAction(false);
  }, [initialTestId]);

  React.useEffect(() => {
    if (previousPhaseRef.current === 'result' && phase === 'active') {
      if (internalResumeRef.current) {
        internalResumeRef.current = false;
      } else if (activeTestId) {
        setStage('questions');
        setQuestionIndex(0);
        setAnswers([]);
        setResult(null);
        setSavedAction(false);
      }
    }
    previousPhaseRef.current = phase;
  }, [activeTestId, phase]);

  const activeTest = LIGHT_TESTS.find((test) => test.id === activeTestId) ?? null;

  const chooseTest = (test: LightTestDefinition): void => {
    internalResumeRef.current = phase === 'result';
    setActiveTestId(test.id);
    setStage('questions');
    setQuestionIndex(0);
    setAnswers([]);
    setResult(null);
    setSavedAction(false);
    onPhaseChange('active');
  };

  const returnToDirectory = (): void => {
    setActiveTestId(null);
    setStage('directory');
    setQuestionIndex(0);
    setAnswers([]);
    setResult(null);
    setSavedAction(false);
    internalResumeRef.current = phase === 'result';
    onPhaseChange('active');
  };

  if (stage === 'directory' || !activeTest) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="text-center">
          <h3 className="text-xl font-semibold text-[#322c36]">今天想从哪里看见自己？</h3>
          <p className="mt-2 text-sm leading-6 text-[#766d78]">
            18 个一分钟轻测试，可以继续换题、测关联主题，没有分数高低。
          </p>
        </div>
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {CATEGORY_ORDER.map((category) => {
            const Icon = TEST_ICONS[category];
            const tests = LIGHT_TESTS.filter((test) => test.category === category);
            return (
              <section
                key={category}
                className="rounded-2xl border border-[#eadfe5] bg-white/80 p-4"
              >
                <header className="mb-3 flex items-center gap-2 text-[#83536b]">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  <h4 className="text-sm font-semibold">{CATEGORY_LABELS[category]}</h4>
                </header>
                <div className="grid gap-2 sm:grid-cols-3">
                  {tests.map((test) => {
                    const completed = completedTestIds.includes(test.id);
                    return (
                      <button
                        key={test.id}
                        type="button"
                        aria-label={test.title}
                        title={test.title}
                        className="rounded-xl border border-[#eee4e9] bg-[#fffafd] p-3 text-left transition hover:-translate-y-0.5 hover:border-[#cdaebe] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a86684]"
                        onClick={() => chooseTest(test)}
                      >
                        <strong className="block text-sm text-[#3b333e]">{test.title}</strong>
                        <span className="mt-1 block text-xs leading-5 text-[#817582]">
                          {test.description}
                        </span>
                        <small className="mt-2 block text-[11px] font-medium text-[#9b6a81]">
                          {completed ? '已完成' : `约 ${test.estimatedSeconds} 秒`}
                        </small>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    );
  }

  if (stage === 'result' && result) {
    const relatedTest = LIGHT_TESTS.find((test) => test.id === activeTest.relatedTestIds[0]);
    const activeIndex = LIGHT_TESTS.findIndex((test) => test.id === activeTest.id);
    const nextTest = LIGHT_TESTS[(activeIndex + 1) % LIGHT_TESTS.length];
    return (
      <div className="mx-auto max-w-2xl" aria-live="polite">
        <section className="rounded-2xl border border-[#e2ced8] bg-[#fff5f9] p-5">
          <p className="text-xs font-semibold tracking-[0.08em] text-[#9b5f78]">
            {RESULT_LABELS[activeTest.category]}
          </p>
          <h3 className="mt-2 text-xl font-semibold text-[#322c36]">{result.title}</h3>
          <p className="mt-2 text-sm leading-6 text-[#655b67]">{result.body}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <ResultNote label="你现在的优势" body={result.strength} />
            <ResultNote label="给自己的提醒" body={result.reminder} />
          </div>
          <div className="mt-3 rounded-xl bg-white/80 p-3 text-sm leading-6 text-[#6d455a]">
            <strong>现在可以做：</strong> {result.action}
          </div>
        </section>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" onClick={() => nextTest && chooseTest(nextTest)}>
            换一套
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => relatedTest && chooseTest(relatedTest)}
          >
            测相关主题
          </Button>
          <Button type="button" variant="outline" onClick={() => chooseTest(activeTest)}>
            重新测试
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={savedAction}
            onClick={() => {
              saveLightTestAction(profileStorageScope, activeTest.id, result.id);
              setSavedAction(true);
            }}
          >
            {savedAction ? '已收藏行动建议' : '收藏行动建议'}
          </Button>
          <Button type="button" variant="ghost" onClick={returnToDirectory}>
            返回测试目录
          </Button>
        </div>
      </div>
    );
  }

  const question = activeTest.questions[questionIndex] ?? activeTest.questions[0];
  if (!question) throw new Error(`Light test ${activeTest.id} has no questions`);

  const chooseAnswer = (answerId: string): void => {
    const nextAnswers = answers.slice(0, questionIndex);
    nextAnswers[questionIndex] = answerId;
    setAnswers(nextAnswers);

    if (questionIndex < activeTest.questions.length - 1) {
      setQuestionIndex((current) => current + 1);
      return;
    }

    const nextResult = scoreLightTest(activeTest, nextAnswers);
    setResult(nextResult);
    setStage('result');
    setCompletedTestIds((current) => [...new Set([...current, activeTest.id])]);
    recordLightTestCompletion(profileStorageScope, activeTest.id);
    onComplete();
    onPhaseChange('result');
  };

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.08em] text-[#9b5f78]">
            {activeTest.title} · {questionIndex + 1}/{activeTest.questions.length}
          </p>
          <h3 className="mt-2 text-xl font-semibold text-[#322c36]">{question.prompt}</h3>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-[#876f7d] hover:bg-[#f7f0f4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a86684]"
          onClick={returnToDirectory}
        >
          返回测试目录
        </button>
      </div>

      <fieldset className="mt-5 grid gap-3 border-0 p-0" aria-label={question.prompt}>
        {question.options.map((option) => {
          const selected = answers[questionIndex] === option.id;
          return (
            <button
              key={option.id}
              type="button"
              className="rounded-xl border border-[#e5dde2] bg-white px-4 py-3 text-left transition hover:border-[#caaaba] hover:bg-[#fffafd] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a86684] aria-pressed:border-[#aa6a88] aria-pressed:bg-[#fff2f7]"
              aria-pressed={selected}
              data-testid="light-test-option"
              onClick={() => chooseAnswer(option.id)}
            >
              <strong className="block text-sm text-[#3b333e]">{option.label}</strong>
              <span className="mt-1 block text-xs leading-5 text-[#7f747f]">{option.body}</span>
            </button>
          );
        })}
      </fieldset>
    </div>
  );
}

function ResultNote({ label, body }: { label: string; body: string }): JSX.Element {
  return (
    <div className="rounded-xl bg-white/75 p-3">
      <strong className="text-xs text-[#8d5871]">{label}</strong>
      <p className="mt-1 text-xs leading-5 text-[#6f6570]">{body}</p>
    </div>
  );
}
