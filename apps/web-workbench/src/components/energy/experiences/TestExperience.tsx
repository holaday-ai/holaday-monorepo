import type { AstroProfile, AstroReading } from '@/lib/astrology';
import { Brain, HandHeart, Hash } from 'lucide-react';
import * as React from 'react';
import type { ExperiencePhase } from '../energy-types';
import {
  LIGHT_TESTS,
  type LightTestContext,
  type LightTestDefinition,
  type LightTestId,
  type LightTestResult,
} from './test-content';

interface TestExperienceProps {
  profile: AstroProfile;
  reading: AstroReading;
  phase: ExperiencePhase;
  onPhaseChange: (phase: ExperiencePhase) => void;
}

const TEST_ICONS = {
  psychology: Brain,
  compatibility: HandHeart,
  'daily-number': Hash,
} satisfies Record<LightTestId, React.ComponentType<{ className?: string }>>;

const RESULT_LABELS = {
  psychology: '今日心理画像',
  compatibility: '今日关系提示',
  'daily-number': '今日数字提示',
} satisfies Record<LightTestId, string>;

export function TestExperience({
  profile,
  reading,
  phase,
  onPhaseChange,
}: TestExperienceProps): JSX.Element {
  const [activeTestId, setActiveTestId] = React.useState<LightTestId | null>(null);
  const [questionIndex, setQuestionIndex] = React.useState(0);
  const [answers, setAnswers] = React.useState<string[]>([]);
  const [result, setResult] = React.useState<LightTestResult | null>(null);
  const previousPhase = React.useRef(phase);
  const startedAt = React.useRef(new Date());
  const context = React.useMemo<LightTestContext>(
    () => ({ profile, reading, date: startedAt.current }),
    [profile, reading],
  );

  React.useEffect(() => {
    if (previousPhase.current === 'result' && phase === 'active') {
      setQuestionIndex(0);
      setAnswers([]);
      setResult(null);
      startedAt.current = new Date();
    }
    previousPhase.current = phase;
  }, [phase]);

  const activeTest = LIGHT_TESTS.find((test) => test.id === activeTestId) ?? null;

  const chooseTest = (test: LightTestDefinition): void => {
    setActiveTestId(test.id);
    setQuestionIndex(0);
    setAnswers([]);
    setResult(null);
    startedAt.current = new Date();
    onPhaseChange('active');
  };

  const returnToDirectory = (): void => {
    setActiveTestId(null);
    setQuestionIndex(0);
    setAnswers([]);
    setResult(null);
    onPhaseChange('active');
  };

  if (!activeTest) {
    return (
      <div className="mx-auto max-w-xl">
        <div className="text-center">
          <h3 className="text-xl font-semibold text-[#322c36]">今天想从哪里看见自己？</h3>
          <p className="mt-2 text-sm leading-6 text-[#766d78]">
            三个测试都很短，没有分数高低，也没有标准答案。
          </p>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {LIGHT_TESTS.map((test) => {
            const Icon = TEST_ICONS[test.id];
            return (
              <button
                key={test.id}
                type="button"
                className="rounded-2xl border border-[#e7dfe4] bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-[#cdaebe] hover:bg-[#fffafd] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a86684]"
                onClick={() => chooseTest(test)}
              >
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#f7ebf0] text-[#9d607b]">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <strong className="mt-4 block text-sm text-[#3b333e]">{test.title}</strong>
                <span className="mt-1 block text-xs leading-5 text-[#817582]">
                  {test.description}
                </span>
                <small className="mt-3 block text-[11px] text-[#a08f99]">
                  约 {test.estimatedSeconds} 秒
                </small>
              </button>
            );
          })}
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

    setResult(activeTest.resultFor(nextAnswers, context));
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
              onClick={() => chooseAnswer(option.id)}
            >
              <strong className="block text-sm text-[#3b333e]">{option.label}</strong>
              <span className="mt-1 block text-xs leading-5 text-[#7f747f]">{option.body}</span>
            </button>
          );
        })}
      </fieldset>

      {result ? (
        <section
          className="mt-6 rounded-2xl border border-[#e2ced8] bg-[#fff5f9] p-5"
          aria-live="polite"
        >
          <p className="text-xs font-semibold tracking-[0.08em] text-[#9b5f78]">
            {RESULT_LABELS[activeTest.id]}
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
      ) : null}
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
