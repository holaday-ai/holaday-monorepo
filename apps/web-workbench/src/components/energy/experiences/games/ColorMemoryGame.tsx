import { Button } from '@/components/ui/button';
import * as React from 'react';

interface ColorMemoryGameProps {
  onComplete: () => void;
}

const TOKENS = [
  { label: '圆形', tone: '#f7a7b8' },
  { label: '方形', tone: '#8fd4e8' },
  { label: '星形', tone: '#f4c86f' },
  { label: '菱形', tone: '#ae9be6' },
] as const;

const ROUND_SEQUENCES = [
  ['圆形', '方形', '星形'],
  ['方形', '星形', '菱形', '圆形'],
  ['星形', '圆形', '菱形', '方形', '星形'],
] as const;

type Stage = 'observe' | 'answer' | 'retry' | 'next';

export function ColorMemoryGame({ onComplete }: ColorMemoryGameProps): JSX.Element {
  const [roundIndex, setRoundIndex] = React.useState(0);
  const [stage, setStage] = React.useState<Stage>('observe');
  const [answerIndex, setAnswerIndex] = React.useState(0);
  const [sequence, setSequence] = React.useState<readonly string[]>(ROUND_SEQUENCES[0]);
  const [message, setMessage] = React.useState('先观察颜色和形状的顺序。');
  const numberedSequence = React.useMemo(() => {
    const counts = new Map<string, number>();
    return sequence.map((label) => {
      const occurrence = (counts.get(label) ?? 0) + 1;
      counts.set(label, occurrence);
      return { id: `${label}-${occurrence}`, label };
    });
  }, [sequence]);

  const choose = (label: string): void => {
    if (label !== sequence[answerIndex]) {
      setSequence((current) => current.slice(0, Math.max(3, current.length - 1)));
      setAnswerIndex(0);
      setStage('retry');
      setMessage('再看一次，这一轮会更短。');
      return;
    }

    const nextIndex = answerIndex + 1;
    if (nextIndex < sequence.length) {
      setAnswerIndex(nextIndex);
      setMessage(`已选对第 ${nextIndex} 个，请继续选择第 ${nextIndex + 1} 个。`);
      return;
    }

    if (roundIndex === ROUND_SEQUENCES.length - 1) {
      onComplete();
      return;
    }
    setStage('next');
    setMessage(`第 ${roundIndex + 1} 轮完成，准备好再看下一轮。`);
  };

  const observe = (): void => {
    const nextRound = stage === 'next' ? roundIndex + 1 : roundIndex;
    setRoundIndex(nextRound);
    if (stage === 'next') {
      setSequence(ROUND_SEQUENCES[nextRound] ?? ROUND_SEQUENCES[0]);
    }
    setAnswerIndex(0);
    setStage('observe');
    setMessage('先观察颜色和形状的顺序。');
  };

  return (
    <div className="mx-auto max-w-xl text-center">
      <p className="text-xs font-semibold tracking-[0.08em] text-[#7b6692]">
        颜色记忆 · 第 {roundIndex + 1} / 3 轮
      </p>
      <h3 className="mt-2 text-xl font-semibold text-[#342d38]">记住这组顺序</h3>
      <output className="mt-2 block text-sm leading-6 text-[#6f6572]" aria-live="polite">
        {message}
      </output>

      {stage === 'observe' ? (
        <div className="mt-6">
          <ol className="flex flex-wrap justify-center gap-3" aria-label="待记忆顺序">
            {numberedSequence.map(({ id, label }, index) => {
              const token = TOKENS.find((item) => item.label === label) ?? TOKENS[0];
              return (
                <li key={id} className="flex flex-col items-center gap-1">
                  <span
                    className="flex h-12 w-12 items-center justify-center rounded-2xl text-sm font-semibold text-[#403747]"
                    style={{ backgroundColor: token.tone }}
                  >
                    {index + 1}
                  </span>
                  <small>{label}</small>
                </li>
              );
            })}
          </ol>
          <Button type="button" className="mt-6 min-h-11" onClick={() => setStage('answer')}>
            开始回答
          </Button>
        </div>
      ) : stage === 'answer' ? (
        <div className="mt-6" data-testid="memory-answer">
          <p className="text-sm text-[#6f6572]">请选择第 {answerIndex + 1} 个形状</p>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {TOKENS.map((token) => (
              <Button
                key={token.label}
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => choose(token.label)}
              >
                {token.label}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <Button type="button" className="mt-6 min-h-11" onClick={observe}>
          {stage === 'retry' ? '重新观察' : '观察下一轮'}
        </Button>
      )}
    </div>
  );
}
