export type VideoCreationScenarioId =
  | 'product_highlight'
  | 'lifestyle_vlog'
  | 'action_remake'
  | 'ip_presenter';

export type ProductionVideoTab = 'normal' | 'pet' | 'ip';

export interface VideoCreationStoryboardBeat {
  label: string;
  title: string;
  duration: string;
  image: string;
}

export interface VideoCreationScenario {
  id: VideoCreationScenarioId;
  videoTab: ProductionVideoTab;
  title: string;
  description: string;
  aspect: string;
  duration: string;
  image: string;
  imagePosition?: string;
  defaultPrompt: string;
  storyboard: readonly VideoCreationStoryboardBeat[];
}

export const VIDEO_CREATION_SCENARIOS: readonly VideoCreationScenario[] = [
  {
    id: 'product_highlight',
    videoTab: 'normal',
    title: '产品高光短片',
    description: '突出产品卖点与质感，打动购买决策',
    aspect: '16:9',
    duration: '8 秒',
    image: '/design-ref/video-scenario-product.jpg',
    defaultPrompt: '帮我制作一条香水产品的高光短片，突出清新花果香调、自然阳光氛围，适合夏季使用。',
    storyboard: [
      {
        label: '开场',
        title: '建立氛围，吸引注意',
        duration: '2 秒',
        image: '/design-ref/video-scenario-product.jpg',
      },
      {
        label: '产品特写',
        title: '展示卖点与细节',
        duration: '4 秒',
        image: '/design-ref/video-storyboard-product-detail.jpg',
      },
      {
        label: '收尾',
        title: '升华感受，强化记忆',
        duration: '2 秒',
        image: '/design-ref/video-storyboard-product-close.jpg',
      },
    ],
  },
  {
    id: 'lifestyle_vlog',
    videoTab: 'normal',
    title: '生活方式 Vlog',
    description: '记录真实生活片段，传递氛围与态度',
    aspect: '9:16',
    duration: '8 秒',
    image: '/design-ref/video-scenario-vlog.jpg',
    defaultPrompt:
      '帮我制作一条清晨湖畔散步的生活方式 Vlog，画面真实松弛，突出微风、咖啡和自然光。',
    storyboard: [
      {
        label: '进入',
        title: '从环境建立情绪',
        duration: '2 秒',
        image: '/design-ref/video-scenario-vlog.jpg',
      },
      {
        label: '过程',
        title: '记录动作与生活细节',
        duration: '4 秒',
        image: '/design-ref/video-scenario-vlog.jpg',
      },
      {
        label: '余韵',
        title: '用自然瞬间收束',
        duration: '2 秒',
        image: '/design-ref/video-scenario-vlog.jpg',
      },
    ],
  },
  {
    id: 'action_remake',
    videoTab: 'pet',
    title: '复刻一段动作',
    description: '模仿参考动作与节奏，轻松复刻效果',
    aspect: '9:16',
    duration: '2–30 秒参考',
    image: '/design-ref/video-scenario-action.jpg',
    defaultPrompt: '保留参考视频中的动作、镜头和节奏，把主角替换成我上传的人物。',
    storyboard: [
      {
        label: '准备',
        title: '对齐人物取景',
        duration: '2–4 秒',
        image: '/design-ref/video-scenario-action.jpg',
      },
      {
        label: '复刻',
        title: '跟随原动作与节奏',
        duration: '8–18 秒',
        image: '/design-ref/video-scenario-action.jpg',
      },
      {
        label: '完成',
        title: '保留原视频收尾',
        duration: '3–6 秒',
        image: '/design-ref/video-scenario-action.jpg',
      },
    ],
  },
  {
    id: 'ip_presenter',
    videoTab: 'ip',
    title: 'IP 人物口播',
    description: '让你的角色开口说话，传递观点与信息',
    aspect: '9:16',
    duration: '≤40 秒口播',
    image: '/design-ref/video-scenario-presenter.jpg',
    defaultPrompt: '大家好，今天想和你分享这款产品最值得关注的三个特点。',
    storyboard: [
      {
        label: '开场',
        title: '角色出镜并建立主题',
        duration: '3–6 秒',
        image: '/design-ref/video-scenario-presenter.jpg',
      },
      {
        label: '表达',
        title: '清楚传递核心观点',
        duration: '12–30 秒',
        image: '/design-ref/video-scenario-presenter.jpg',
      },
      {
        label: '结尾',
        title: '总结并给出行动提示',
        duration: '3–8 秒',
        image: '/design-ref/video-scenario-presenter.jpg',
      },
    ],
  },
] as const;

const SCENARIO_BY_ID = new Map(VIDEO_CREATION_SCENARIOS.map((scenario) => [scenario.id, scenario]));

export function videoCreationScenario(id: VideoCreationScenarioId): VideoCreationScenario {
  return SCENARIO_BY_ID.get(id) ?? VIDEO_CREATION_SCENARIOS[0];
}

export function videoTabForScenario(id: VideoCreationScenarioId): ProductionVideoTab {
  return videoCreationScenario(id).videoTab;
}

export function scenarioForVideoTab(
  tab: ProductionVideoTab,
  preferredNormal: VideoCreationScenarioId = 'product_highlight',
): VideoCreationScenarioId {
  if (tab === 'pet') return 'action_remake';
  if (tab === 'ip') return 'ip_presenter';
  return videoTabForScenario(preferredNormal) === 'normal' ? preferredNormal : 'product_highlight';
}
