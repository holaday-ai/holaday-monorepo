import type { AstroProfile, AstroReading } from '@/lib/astrology';

export type LightTestId = 'psychology' | 'compatibility' | 'daily-number';

export interface LightTestContext {
  profile: AstroProfile;
  reading: AstroReading;
  date: Date;
}

export interface LightTestResult {
  title: string;
  body: string;
  strength: string;
  reminder: string;
  action: string;
}

export interface LightTestDefinition {
  id: LightTestId;
  title: string;
  description: string;
  estimatedSeconds: number;
  questions: Array<{
    id: string;
    prompt: string;
    options: Array<{ id: string; label: string; body: string }>;
  }>;
  resultFor: (answers: string[], context: LightTestContext) => LightTestResult;
}

const PSYCHOLOGY_RESULTS: Record<string, LightTestResult> = {
  fast: {
    title: '行动型节奏',
    body: '你现在适合用速度换清晰度。先做一个粗版本，别在开局就追求完美。',
    strength: '启动快，适合把模糊任务先撞出一个轮廓。',
    reminder: '不要一边冲一边开太多分支，先把一个动作跑完。',
    action: '先开一个 10 分钟小冲刺，结束后再判断要不要加深。',
  },
  steady: {
    title: '秩序型节奏',
    body: '你更需要可控感。把任务拆成三步，会比临场发挥更容易进入状态。',
    strength: '适合做判断、归类和复盘，把混乱变成顺序。',
    reminder: '别把计划写太满，留一个可以调整的空格。',
    action: '把最小下一步写出来，完成后再切到第二步。',
  },
  soft: {
    title: '感受型节奏',
    body: '你的注意力和感受绑定得更紧。先降噪，再做决定，会更容易稳定输出。',
    strength: '很会捕捉氛围，适合处理关系、表达和细节。',
    reminder: '先把感受安顿好，再回复消息或做决定。',
    action: '先整理桌面或喝点水，再处理最需要沟通的一件事。',
  },
};

const COMPATIBILITY_RESULTS: Record<string, Omit<LightTestResult, 'body'>> = {
  spark: {
    title: '一起点亮一件小事',
    strength: '新鲜感会让你们更容易打开话题。',
    reminder: '别把热闹误认为已经对齐期待。',
    action: '一起选一件半小时内能完成的小事。',
  },
  steady: {
    title: '先把期待说清楚',
    strength: '具体、稳定的表达会让关系更有安全感。',
    reminder: '少猜对方的想法，多问一个具体问题。',
    action: '用一句话说清今天最希望彼此配合什么。',
  },
  space: {
    title: '留一点空间也在靠近',
    strength: '尊重彼此节奏，会让互动更轻松。',
    reminder: '安静不等于疏远，记得留下一个可回应的信号。',
    action: '约定稍后再联系的时间，然后安心做自己的事。',
  },
};

const NUMBER_ACTIONS: Record<string, { body: string; action: string }> = {
  work: {
    body: '把数字当成一个轻量起点，今天只推进最能看见变化的一步。',
    action: '选一个可以在这个数字对应分钟数内完成的小动作。',
  },
  relationship: {
    body: '今天的提示适合用来打开交流，不需要一次把所有话说完。',
    action: '给一位在意的人发一句具体、轻松的问候。',
  },
  rest: {
    body: '数字不是任务指标，只是提醒你把一点时间还给自己。',
    action: '留出一小段无通知时间，做一件没有产出要求的事。',
  },
};

export const LIGHT_TESTS: LightTestDefinition[] = [
  {
    id: 'psychology',
    title: '心理状态',
    description: '看看今天更适合怎样开始',
    estimatedSeconds: 30,
    questions: [
      {
        id: 'task-style',
        prompt: '现在遇到任务，你更像哪一种？',
        options: [
          { id: 'fast', label: '先冲再调', body: '脑子里已经有方向，最怕被流程拖住。' },
          { id: 'steady', label: '先稳住节奏', body: '希望事情有条理，最好一步一步推进。' },
          { id: 'soft', label: '先照顾感受', body: '今天更在意氛围、关系和心里的松紧。' },
        ],
      },
    ],
    resultFor: (answers) => PSYCHOLOGY_RESULTS[answers[0] ?? ''] ?? PSYCHOLOGY_RESULTS.steady,
  },
  {
    id: 'compatibility',
    title: '关系合拍',
    description: '看看今天适合怎样靠近',
    estimatedSeconds: 45,
    questions: [
      {
        id: 'relationship-rhythm',
        prompt: '你希望今天的关系更靠近哪种节奏？',
        options: [
          { id: 'spark', label: '一起做点新鲜的事', body: '想让互动多一点火花。' },
          { id: 'steady', label: '把期待说清楚', body: '想减少猜测，稳稳对齐。' },
          { id: 'space', label: '各自留一点空间', body: '想靠近，也想保留自己的节奏。' },
        ],
      },
    ],
    resultFor: (answers, context) => {
      const answer = answers[0] ?? 'steady';
      const copy = COMPATIBILITY_RESULTS[answer] ?? COMPATIBILITY_RESULTS.steady;
      const tone = pick(localSeed(`${context.profile.zodiacSign}-${answer}`), [
        '今天更适合从一个具体的小约定开始。',
        '把语气放轻一点，回应会比结论更重要。',
        '不急着证明默契，先让彼此都容易回答。',
      ]);
      return { ...copy, body: tone };
    },
  },
  {
    id: 'daily-number',
    title: '今日数字',
    description: '拿一个数字当作今天的小提示',
    estimatedSeconds: 30,
    questions: [
      {
        id: 'number-focus',
        prompt: '你想把今天的数字提示用在哪里？',
        options: [
          { id: 'work', label: '工作推进', body: '给最重要的一步一个起点。' },
          { id: 'relationship', label: '关系沟通', body: '给今天的交流一点提示。' },
          { id: 'rest', label: '休息放空', body: '把一点时间还给自己。' },
        ],
      },
    ],
    resultFor: (answers, context) => {
      const lifePath = reduceNumber(context.profile.birthday);
      const [, month = '1', day = '1'] = context.profile.birthday.split('-');
      const personalYear = reduceNumber(`${context.date.getFullYear()}${month}${day}`);
      const dailyNumber = reduceNumber(`${lifePath}${personalYear}${context.reading.energyScore}`);
      const focus = NUMBER_ACTIONS[answers[0] ?? ''] ?? NUMBER_ACTIONS.work;
      return {
        title: `今日行动数 ${dailyNumber}`,
        body: focus.body,
        strength: `数字 ${dailyNumber} 提醒你：先给今天一个清楚但不沉重的落点。`,
        reminder: '它只是轻提示，不替你决定结果，也不需要刻意凑数。',
        action: focus.action,
      };
    },
  },
];

function reduceNumber(value: string): number {
  let total = value
    .replace(/\D/g, '')
    .split('')
    .reduce((sum, digit) => sum + Number(digit), 0);
  while (total > 9) {
    total = String(total)
      .split('')
      .reduce((sum, digit) => sum + Number(digit), 0);
  }
  return total || 1;
}

function localSeed(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function pick<T>(seed: number, values: readonly [T, ...T[]]): T {
  return values[seed % values.length] ?? values[0];
}
