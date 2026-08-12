import { Button } from '@/components/ui/button';
import {
  BookOpenText,
  BriefcaseBusiness,
  CircleHelp,
  Heart,
  HeartPulse,
  Layers3,
  Save,
  ShieldCheck,
  Sparkles,
  SunMedium,
  Wind,
} from 'lucide-react';
import * as React from 'react';
import { saveEnergyCardIds } from '../energy-progress';
import type { ExperiencePhase } from '../energy-types';
import {
  HOLADAY_ENERGY_CARDS,
  type HoladayCardTheme,
  type HoladayEnergyCard,
} from './energy-card-content';
import { drawEnergyCards } from './energy-card-selection';

type CardLabMode = 'single' | 'yes-no' | 'three';
type CardLabStage = 'directory' | 'theme' | 'ready' | 'revealed' | 'history';

interface CardLabHistoryEntry {
  mode: CardLabMode;
  cardIds: string[];
  createdAt: number;
}

interface TarotExperienceProps {
  profileStorageScope: string | null;
  capabilities: Record<string, boolean>;
  initialMode?: CardLabMode;
  initialTheme?: HoladayCardTheme;
  phase: ExperiencePhase;
  onPhaseChange: (phase: ExperiencePhase) => void;
  onComplete?: () => void;
}

const THEMES: Array<{
  id: HoladayCardTheme;
  label: string;
  body: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'work', label: '工作推进', body: '给卡住的一步一点提示', icon: BriefcaseBusiness },
  { id: 'relationship', label: '关系回应', body: '看看怎样表达更轻松', icon: Heart },
  { id: 'emotion', label: '情绪整理', body: '先看见当下的感受', icon: HeartPulse },
  { id: 'space', label: '给自己空间', body: '把注意力放回自己', icon: Wind },
  { id: 'confidence', label: '找回自信', body: '用真实证据支持自己', icon: ShieldCheck },
  { id: 'uplift', label: '轻轻提振', body: '补一点明亮的能量', icon: SunMedium },
];

const MODE_OPTIONS: Array<{
  id: CardLabMode;
  label: string;
  body: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'single', label: '单张能量牌', body: '带走一条能马上使用的提示', icon: Sparkles },
  { id: 'yes-no', label: '是 / 否能量牌', body: '问题留在心里，只看行动方向', icon: CircleHelp },
  { id: 'three', label: '三张能量牌', body: '从回顾、当下到下一步慢慢看', icon: Layers3 },
];

const ANSWER_LABELS: Record<HoladayEnergyCard['answer'], string> = {
  yes: 'YES',
  no: 'NO',
  wait: 'WAIT',
};

const THREE_CARD_LABELS = ['回顾', '当下', '下一步'] as const;

export function TarotExperience({
  profileStorageScope,
  capabilities,
  initialMode,
  initialTheme,
  phase,
  onPhaseChange,
  onComplete = () => undefined,
}: TarotExperienceProps): JSX.Element {
  const [mode, setMode] = React.useState<CardLabMode | null>(initialMode ?? null);
  const [stage, setStage] = React.useState<CardLabStage>(() =>
    initialMode ? 'theme' : 'directory',
  );
  const [theme, setTheme] = React.useState<HoladayCardTheme>(initialTheme ?? 'work');
  const [cards, setCards] = React.useState<HoladayEnergyCard[]>([]);
  const [seenIds, setSeenIds] = React.useState<string[]>([]);
  const [history, setHistory] = React.useState<CardLabHistoryEntry[]>([]);
  const [saved, setSaved] = React.useState(false);
  const sessionSeedRef = React.useRef(`${profileStorageScope ?? 'guest'}:${Date.now()}`);
  const drawIndexRef = React.useRef(0);
  const completionReportedRef = React.useRef(false);
  const internalResumeRef = React.useRef(false);
  const previousPhaseRef = React.useRef(phase);
  const launchRef = React.useRef(`${initialMode ?? ''}:${initialTheme ?? ''}`);

  React.useEffect(() => {
    const launchKey = `${initialMode ?? ''}:${initialTheme ?? ''}`;
    if (!initialMode || launchRef.current === launchKey) return;
    launchRef.current = launchKey;
    setMode(initialMode);
    setTheme(initialTheme ?? 'work');
    setStage('theme');
    setCards([]);
    setSaved(false);
  }, [initialMode, initialTheme]);

  React.useEffect(() => {
    if (previousPhaseRef.current === 'result' && phase === 'active') {
      if (internalResumeRef.current) {
        internalResumeRef.current = false;
      } else {
        setMode(initialMode ?? null);
        setStage(initialMode ? 'theme' : 'directory');
        setTheme(initialTheme ?? 'work');
        setCards([]);
        setSeenIds([]);
        setHistory([]);
        setSaved(false);
        drawIndexRef.current = 0;
        completionReportedRef.current = false;
      }
    }
    previousPhaseRef.current = phase;
  }, [initialMode, initialTheme, phase]);

  const draw = React.useCallback(
    (nextMode: CardLabMode): HoladayEnergyCard[] => {
      const count = nextMode === 'three' ? 3 : 1;
      const nextCards = drawEnergyCards({
        mode: nextMode,
        theme,
        count,
        seed: `${sessionSeedRef.current}:${drawIndexRef.current}`,
        seenIds,
      });
      drawIndexRef.current += 1;
      setMode(nextMode);
      setCards(nextCards);
      setSeenIds((current) => [...new Set([...current, ...nextCards.map((card) => card.id)])]);
      setSaved(false);
      return nextCards;
    },
    [seenIds, theme],
  );

  const reveal = React.useCallback(
    (revealedCards: HoladayEnergyCard[], revealedMode: CardLabMode): void => {
      setStage('revealed');
      setHistory((current) => [
        ...current,
        {
          mode: revealedMode,
          cardIds: revealedCards.map((card) => card.id),
          createdAt: Date.now(),
        },
      ]);
      if (!completionReportedRef.current) {
        completionReportedRef.current = true;
        onComplete();
      }
      onPhaseChange('result');
    },
    [onComplete, onPhaseChange],
  );

  if (stage === 'directory') {
    return (
      <div className="energy-card-lab energy-card-lab--directory">
        <header>
          <p className="energy-kicker">Holaday 编辑内容</p>
          <h3>Holaday 能量牌</h3>
          <p>不是占卜结论，只是一组帮你停一下、换个角度的轻提示。</p>
          <small>
            {capabilities['daily-tarot']
              ? 'Provider 能力已检测，本轮仍使用 Holaday 能量牌。'
              : '当前不调用 Provider 塔罗接口。'}
          </small>
        </header>
        <div className="energy-card-lab__mode-grid">
          {MODE_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                type="button"
                aria-label={option.label}
                title={option.label}
                onClick={() => {
                  setMode(option.id);
                  setStage('theme');
                }}
              >
                <Icon aria-hidden="true" />
                <strong>{option.label}</strong>
                <span>{option.body}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (stage === 'theme') {
    return (
      <div className="energy-card-lab energy-card-lab--theme">
        <header>
          <p className="energy-kicker">Holaday 能量牌</p>
          <h3>这一次想看哪个方向？</h3>
          <p>{mode === 'yes-no' ? '问题只留在心里，不输入、不上传。' : '选择最接近此刻的一项。'}</p>
        </header>
        <fieldset>
          <legend>抽卡主题</legend>
          <div className="energy-card-lab__theme-grid">
            {THEMES.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-label={item.label}
                  title={item.label}
                  aria-pressed={theme === item.id}
                  onClick={() => setTheme(item.id)}
                >
                  <Icon aria-hidden="true" />
                  <strong>{item.label}</strong>
                  <span>{item.body}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
        <Button
          type="button"
          onClick={() => {
            if (!mode) return;
            draw(mode);
            setStage('ready');
          }}
        >
          开始抽卡
        </Button>
      </div>
    );
  }

  if (stage === 'ready') {
    return (
      <div className="energy-card-lab energy-card-lab--ready">
        <img
          src="/energy/tarot-cards.jpg"
          alt={mode === 'three' ? '等待翻开的三张 Holaday 能量牌' : '等待翻开的 Holaday 能量牌'}
        />
        <p>
          {mode === 'yes-no'
            ? '问题只留在心里，准备好再看回答。'
            : '牌已经来到你面前，准备好再翻开。'}
        </p>
        <Button
          type="button"
          onClick={() => {
            if (!mode) return;
            reveal(cards, mode);
          }}
        >
          {mode === 'three' ? '翻开三张牌' : mode === 'yes-no' ? '翻开回答牌' : '翻开这张牌'}
        </Button>
      </div>
    );
  }

  if (stage === 'history') {
    return (
      <div className="energy-card-lab energy-card-lab--history">
        <header>
          <BookOpenText aria-hidden="true" />
          <h3>本次记录</h3>
          <p>只保留当前打开期间的牌面记录，问题内容从未被收集。</p>
        </header>
        <ol>
          {history.map((entry, index) => (
            <li key={`${entry.createdAt}-${index}`}>
              <strong>第 {index + 1} 次</strong>
              <span>{modeLabel(entry.mode)}</span>
              <p>{entry.cardIds.map(cardTitle).join(' · ')}</p>
            </li>
          ))}
        </ol>
        <Button type="button" variant="outline" onClick={() => setStage('revealed')}>
          返回当前提示
        </Button>
      </div>
    );
  }

  const currentMode = mode ?? 'single';
  return (
    <div className="energy-card-lab energy-card-lab--revealed" aria-live="polite">
      <header>
        <p className="energy-kicker">Holaday 编辑内容</p>
        <h3>Holaday 能量牌</h3>
      </header>
      <div className={`energy-card-lab__results energy-card-lab__results--${currentMode}`}>
        {cards.map((card, index) => (
          <article key={card.id} data-testid="energy-card-result">
            {currentMode === 'three' ? <span>{THREE_CARD_LABELS[index]}</span> : null}
            {currentMode === 'yes-no' ? (
              <strong className="energy-card-lab__answer">{ANSWER_LABELS[card.answer]}</strong>
            ) : null}
            <h4>{card.title}</h4>
            <p>{card.subtitle}</p>
            <p>{card.body}</p>
            <div>
              <strong>15 分钟内可以做</strong>
              <p>{card.action}</p>
            </div>
          </article>
        ))}
      </div>

      <div className="energy-card-lab__result-actions">
        <Button
          type="button"
          onClick={() => {
            internalResumeRef.current = true;
            onPhaseChange('active');
            draw(currentMode);
            setStage('ready');
          }}
        >
          再抽一次
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            internalResumeRef.current = true;
            onPhaseChange('active');
            setStage('theme');
          }}
        >
          换个主题
        </Button>
        {currentMode !== 'three' ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const nextCards = draw('three');
              reveal(nextCards, 'three');
            }}
          >
            进入三张牌
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          disabled={saved}
          onClick={() => {
            saveEnergyCardIds(
              profileStorageScope,
              cards.map((card) => card.id),
            );
            setSaved(true);
          }}
        >
          <Save aria-hidden="true" />
          {saved ? '已收藏本次提示' : '收藏本次提示'}
        </Button>
        <Button type="button" variant="outline" onClick={() => setStage('history')}>
          <BookOpenText aria-hidden="true" />
          本次记录
        </Button>
      </div>
    </div>
  );
}

function modeLabel(mode: CardLabMode): string {
  if (mode === 'single') return '单张能量牌';
  if (mode === 'yes-no') return '是 / 否能量牌';
  return '三张能量牌';
}

function cardTitle(cardId: string): string {
  return HOLADAY_ENERGY_CARDS.find((card) => card.id === cardId)?.title ?? cardId;
}
