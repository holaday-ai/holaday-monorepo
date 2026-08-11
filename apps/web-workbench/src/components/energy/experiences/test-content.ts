import type { AstroProfile, AstroReading } from '@/lib/astrology';

export type LightTestCategory =
  | 'emotion'
  | 'stress'
  | 'work'
  | 'relationship'
  | 'social'
  | 'daily-number';

export const REQUIRED_TEST_IDS = [
  'emotion-battery',
  'emotion-weather',
  'emotion-recovery',
  'stress-signal',
  'stress-rhythm',
  'stress-boundary',
  'work-start',
  'work-focus',
  'work-finish',
  'relationship-expression',
  'relationship-distance',
  'relationship-listening',
  'social-energy',
  'social-boundary',
  'social-recharge',
  'daily-number-action',
  'daily-number-relationship',
  'daily-number-rest',
] as const;

export type LightTestId = (typeof REQUIRED_TEST_IDS)[number];

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

export interface LightTestOption {
  id: string;
  label: string;
  body: string;
  points: number;
}

export interface LightTestOutcome extends LightTestResult {
  id: 'recover' | 'steady' | 'build' | 'charge';
  minScore: number;
  maxScore: number;
}

export interface LightTestDefinition {
  id: LightTestId;
  category: LightTestCategory;
  title: string;
  description: string;
  estimatedSeconds: number;
  questions: Array<{ id: string; prompt: string; options: LightTestOption[] }>;
  outcomes: LightTestOutcome[];
  relatedTestIds: LightTestId[];
  resultFor: (answers: string[], context: LightTestContext) => LightTestOutcome;
}

interface TestBlueprint {
  id: LightTestId;
  category: LightTestCategory;
  title: string;
  description: string;
  prompts: [string, string, string, string, string];
  relatedTestIds: [LightTestId, LightTestId];
}

const BLUEPRINTS: TestBlueprint[] = [
  {
    id: 'emotion-battery',
    category: 'emotion',
    title: '情绪电量',
    description: '看看此刻还有多少内在余量',
    prompts: [
      '我能察觉自己什么时候开始累。',
      '我能在情绪变重前暂停一下。',
      '我能说出此刻最接近的感受。',
      '我愿意向可信的人说明需要。',
      '我能给今天留下一段恢复时间。',
    ],
    relatedTestIds: ['emotion-weather', 'emotion-recovery'],
  },
  {
    id: 'emotion-weather',
    category: 'emotion',
    title: '内心天气',
    description: '辨认情绪变化与回应空间',
    prompts: [
      '我能发现心情正在发生变化。',
      '我能区分事实和自己的解释。',
      '我允许情绪存在而不急着赶走它。',
      '我能用不责备的方式表达感受。',
      '波动过后，我知道怎样慢慢回来。',
    ],
    relatedTestIds: ['emotion-battery', 'stress-signal'],
  },
  {
    id: 'emotion-recovery',
    category: 'emotion',
    title: '恢复方式',
    description: '找到今天真正有用的恢复入口',
    prompts: [
      '我知道哪种休息对自己最有效。',
      '我能在需要时减少新的信息输入。',
      '我愿意降低今天不必要的标准。',
      '我能安排一个短而真实的恢复动作。',
      '休息后，我能温和地重新开始。',
    ],
    relatedTestIds: ['emotion-battery', 'social-recharge'],
  },
  {
    id: 'stress-signal',
    category: 'stress',
    title: '压力信号',
    description: '看看自己多早能听见身体提醒',
    prompts: [
      '我能留意肩颈、呼吸或胃部的变化。',
      '我能在压力加重前减少一项任务。',
      '我知道今天最重要的事情是什么。',
      '我能把卡点清楚地告诉相关人。',
      '忙碌结束后，我有办法切换状态。',
    ],
    relatedTestIds: ['stress-rhythm', 'stress-boundary'],
  },
  {
    id: 'stress-rhythm',
    category: 'stress',
    title: '节奏缓冲',
    description: '看看日程有没有留出呼吸',
    prompts: [
      '我的任务之间留有一点切换时间。',
      '我能在专注后主动安排短休息。',
      '我不会把每个空档都立刻填满。',
      '我能根据能量调整任务难度。',
      '我知道一天应该在什么时候收尾。',
    ],
    relatedTestIds: ['stress-signal', 'work-focus'],
  },
  {
    id: 'stress-boundary',
    category: 'stress',
    title: '压力边界',
    description: '分清哪些重量真正属于自己',
    prompts: [
      '我能区分自己的责任和别人的期待。',
      '超出余量时，我能提出调整。',
      '我拒绝请求时不需要反复解释。',
      '我愿意把可协作的部分交出去。',
      '离开工作后，我能减少继续反刍。',
    ],
    relatedTestIds: ['stress-signal', 'social-boundary'],
  },
  {
    id: 'work-start',
    category: 'work',
    title: '开工阻力',
    description: '找到最容易启动的第一步',
    prompts: [
      '我能把任务缩成一个很小的动作。',
      '我允许第一版不够完整。',
      '我能给开始设置一段短时间。',
      '标准不清楚时，我会主动确认。',
      '完成第一步后，我知道怎样继续。',
    ],
    relatedTestIds: ['work-focus', 'work-finish'],
  },
  {
    id: 'work-focus',
    category: 'work',
    title: '专注入口',
    description: '看看注意力最容易在哪里安定',
    prompts: [
      '我能在同一时间只处理一件事。',
      '我会主动减少无关通知和页面。',
      '被打断后，我能回到原来的位置。',
      '我能识别今天真正重要的优先级。',
      '专注一段时间后，我会适时休息。',
    ],
    relatedTestIds: ['work-start', 'work-finish'],
  },
  {
    id: 'work-finish',
    category: 'work',
    title: '收尾能力',
    description: '看看任务怎样真正离开待办区',
    prompts: [
      '开始前，我知道怎样算完成。',
      '我能分清必要细节和过度打磨。',
      '我会给结果安排一次简短检查。',
      '做到标准后，我愿意发出或交付。',
      '我会记录下一步，让大脑暂时放下。',
    ],
    relatedTestIds: ['work-start', 'work-focus'],
  },
  {
    id: 'relationship-expression',
    category: 'relationship',
    title: '关系表达',
    description: '看看期待能否被清楚听见',
    prompts: [
      '我能先说事实，再说自己的感受。',
      '我能把期待变成一个具体请求。',
      '我会选择双方都有余量的沟通时点。',
      '表达时，我能避免替对方下结论。',
      '我允许对方给出不同的回应。',
    ],
    relatedTestIds: ['relationship-listening', 'relationship-distance'],
  },
  {
    id: 'relationship-distance',
    category: 'relationship',
    title: '靠近距离',
    description: '找到亲近与空间之间的舒服位置',
    prompts: [
      '我知道自己此刻想靠近还是独处。',
      '对方安静时，我不会立刻做负面推测。',
      '我能给彼此空间并留下回应信号。',
      '距离不舒服时，我愿意温和询问。',
      '一次误会后，我愿意重新建立连接。',
    ],
    relatedTestIds: ['relationship-expression', 'social-boundary'],
  },
  {
    id: 'relationship-listening',
    category: 'relationship',
    title: '倾听频道',
    description: '看看回应之前有没有真正听见',
    prompts: [
      '对话时，我能让对方完整说完。',
      '我会复述重点来确认理解。',
      '不确定时，我会问一个具体问题。',
      '我能听见内容背后的感受。',
      '我会先确认对方需要倾听还是建议。',
    ],
    relatedTestIds: ['relationship-expression', 'social-energy'],
  },
  {
    id: 'social-energy',
    category: 'social',
    title: '社交电量',
    description: '看看今天适合怎样与人连接',
    prompts: [
      '我能判断自己今天适合多少互动。',
      '见人前，我会给自己一点准备时间。',
      '互动中，我能照顾自己的节奏。',
      '需要离开时，我能清楚表达。',
      '社交结束后，我会安排恢复。',
    ],
    relatedTestIds: ['social-boundary', 'social-recharge'],
  },
  {
    id: 'social-boundary',
    category: 'social',
    title: '社交边界',
    description: '看看拒绝与回应是否都够轻松',
    prompts: [
      '我能拒绝不适合自己的邀请。',
      '暂时无法回复时，我会说明时间。',
      '我不需要用很多解释换取理解。',
      '不舒服时，我能提出调整。',
      '我会保护固定的独处时间。',
    ],
    relatedTestIds: ['social-energy', 'stress-boundary'],
  },
  {
    id: 'social-recharge',
    category: 'social',
    title: '连接式恢复',
    description: '找到能让你真正轻松的陪伴方式',
    prompts: [
      '我知道独处和陪伴哪种更适合今天。',
      '我有至少一个低压力的联系对象。',
      '我能发出简单而明确的邀请。',
      '相处时，我不需要持续表现。',
      '结束互动后，我通常感觉更有余量。',
    ],
    relatedTestIds: ['social-energy', 'emotion-recovery'],
  },
  {
    id: 'daily-number-action',
    category: 'daily-number',
    title: '今日行动数字',
    description: '把数字当作轻量行动提示',
    prompts: [
      '我愿意把目标缩成一个可数的小步骤。',
      '我能用短时间开始，而不是等待状态。',
      '我会在完成一轮后停下来观察。',
      '我不会为了凑数字增加无效任务。',
      '数字提示对我来说只是提醒而非要求。',
    ],
    relatedTestIds: ['work-start', 'daily-number-rest'],
  },
  {
    id: 'daily-number-relationship',
    category: 'daily-number',
    title: '今日连接数字',
    description: '用一个数字打开轻松交流',
    prompts: [
      '我愿意主动发出一次简单问候。',
      '我能把交流目标放得轻一点。',
      '我会给对方足够的回应时间。',
      '没有即时回复时，我能继续自己的安排。',
      '我不会把数字提示当成关系结论。',
    ],
    relatedTestIds: ['relationship-expression', 'social-energy'],
  },
  {
    id: 'daily-number-rest',
    category: 'daily-number',
    title: '今日休息数字',
    description: '用小数字把时间还给自己',
    prompts: [
      '我愿意留出一段没有产出要求的时间。',
      '休息时，我能减少查看新消息。',
      '我能选择一个身体喜欢的恢复动作。',
      '时间到了，我不会责怪自己休息太少。',
      '数字提示不会替代我对身体的判断。',
    ],
    relatedTestIds: ['emotion-recovery', 'stress-rhythm'],
  },
];

const OPTION_SCALE: Array<Omit<LightTestOption, 'id'>> = [
  { label: '还没有', body: '目前很难做到，需要先减少一点压力。', points: 0 },
  { label: '偶尔可以', body: '在条件合适时能做到，但还不稳定。', points: 1 },
  { label: '大多可以', body: '多数时候能做到，偶尔需要提醒。', points: 2 },
  { label: '已经很稳', body: '这已经是目前可依靠的一项能力。', points: 3 },
];

const ACTIONS: Record<LightTestCategory, [string, string, string, string]> = {
  emotion: [
    '用 5 分钟写下此刻的感受和一个需要。',
    '做 8 次慢呼吸，再删掉一项非必要安排。',
    '用 10 分钟完成一个真正能恢复的小动作。',
    '把今天有效的情绪照顾方法记录成一句提醒。',
  ],
  stress: [
    '暂停 5 分钟，只观察身体哪里最紧。',
    '用 8 分钟列出今天唯一的优先事项。',
    '关掉通知 10 分钟，完成一个开放循环。',
    '写下一条可持续边界，并在今天实际使用一次。',
  ],
  work: [
    '把任务缩成一个 5 分钟内能开始的动作。',
    '关闭三个无关窗口，专注 8 分钟。',
    '用 10 分钟做出可检查的第一版。',
    '把当前成果发给一个可信对象获取反馈。',
  ],
  relationship: [
    '用 5 分钟写下一句不责备的具体请求。',
    '下一次回应前，先复述对方的一句重点。',
    '用 10 分钟整理事实、感受和需要。',
    '发出一次轻量邀请，并允许对方自由回应。',
  ],
  social: [
    '给自己安排 5 分钟无消息空档。',
    '回复一条最想回应的消息，其余稍后处理。',
    '用 10 分钟安排一次低压力连接或独处。',
    '把最有效的社交边界写下来并保存。',
  ],
  'daily-number': [
    '选一个 5 分钟内能完成的小动作。',
    '让数字只决定时长，不决定结果，行动 8 分钟。',
    '用 10 分钟完成一次行动、连接或休息。',
    '记录今天最适合自己的节奏，不追求凑数。',
  ],
};

export const LIGHT_TESTS: LightTestDefinition[] = BLUEPRINTS.map(defineTest);

function defineTest(blueprint: TestBlueprint): LightTestDefinition {
  const outcomes = buildOutcomes(blueprint.category, blueprint.title);
  const definition: LightTestDefinition = {
    id: blueprint.id,
    category: blueprint.category,
    title: blueprint.title,
    description: blueprint.description,
    estimatedSeconds: 75,
    questions: blueprint.prompts.map((prompt, questionIndex) => ({
      id: `${blueprint.id}-q${questionIndex + 1}`,
      prompt,
      options: OPTION_SCALE.map((option) => ({
        ...option,
        id: `${blueprint.id}-q${questionIndex + 1}-p${option.points}`,
      })),
    })),
    outcomes,
    relatedTestIds: blueprint.relatedTestIds,
    resultFor: (answers) => selectOutcome(definition, answers),
  };
  return definition;
}

function buildOutcomes(category: LightTestCategory, title: string): LightTestOutcome[] {
  const actions = ACTIONS[category];
  return [
    {
      id: 'recover',
      minScore: 0,
      maxScore: 3,
      title: '先补回基本余量',
      body: `${title}显示你此刻更需要减轻负荷。先照顾最基础的一步，不必追赶理想状态。`,
      strength: '你已经愿意停下来观察，这就是恢复的入口。',
      reminder: '结果只描述此刻，不代表固定性格或长期状态。',
      action: actions[0],
    },
    {
      id: 'steady',
      minScore: 4,
      maxScore: 7,
      title: '先把节奏稳住',
      body: `${title}显示你有一些可用资源，也有需要保护的余量。今天适合少而清楚。`,
      strength: '你能在部分场景里照顾自己，并且愿意调整。',
      reminder: '不用同时改善所有地方，选一个最有帮助的动作。',
      action: actions[1],
    },
    {
      id: 'build',
      minScore: 8,
      maxScore: 11,
      title: '正在建立稳定感',
      body: `${title}显示你已经拥有不少可依靠的方法。继续用小行动把它变得更稳定。`,
      strength: '你能识别需要，也能把观察转成具体选择。',
      reminder: '状态好时也要保留边界，避免一次把余量用完。',
      action: actions[2],
    },
    {
      id: 'charge',
      minScore: 12,
      maxScore: 15,
      title: '今天有可用能量',
      body: `${title}显示你现在有较清楚的节奏和回应能力。可以把能量用在真正重要的地方。`,
      strength: '你已经形成可持续的方法，也能留意自己的变化。',
      reminder: '有能量不代表需要做更多，保留余量同样重要。',
      action: actions[3],
    },
  ];
}

function selectOutcome(test: LightTestDefinition, answers: string[]): LightTestOutcome {
  const score = test.questions.reduce((total, question, index) => {
    return total + (question.options.find((option) => option.id === answers[index])?.points ?? 0);
  }, 0);
  return (
    test.outcomes.find((outcome) => score >= outcome.minScore && score <= outcome.maxScore) ??
    test.outcomes[0]
  );
}
