import type { EnergyPracticeId } from '../energy-content-target';

export interface EnergyPracticeStep {
  title: string;
  body: string;
}

export interface EnergyPracticeDefinition {
  id: EnergyPracticeId;
  title: string;
  description: string;
  estimatedSeconds: number;
  tone: 'lavender' | 'mint' | 'peach' | 'sky' | 'sun';
  steps: readonly EnergyPracticeStep[];
  completionTitle: string;
  completionAction: string;
}

export const PRACTICE_CONTENT: readonly EnergyPracticeDefinition[] = [
  {
    id: 'breath-window',
    title: '窗边八次慢呼吸',
    description: '把视线和呼吸一起放远一点',
    estimatedSeconds: 60,
    tone: 'lavender',
    steps: [
      { title: '找到一个远处的点', body: '看向窗外或房间最远处，让目光轻轻停在那里。' },
      { title: '完成四次慢呼吸', body: '吸气时不用刻意加深，呼气时让肩膀松下一点。' },
      { title: '再做四次', body: '保持视线柔和，数到八就停，不需要追求标准节奏。' },
    ],
    completionTitle: '呼吸空间已经回来一点',
    completionAction: '选眼前最小的一步开始，不把刚得到的空白立刻填满。',
  },
  {
    id: 'shoulder-release',
    title: '肩颈一分钟松绑',
    description: '让久坐的紧绷慢慢离开',
    estimatedSeconds: 60,
    tone: 'peach',
    steps: [
      { title: '双脚踩稳', body: '让脚掌接触地面，背部不必刻意挺直。' },
      { title: '肩膀向后绕三圈', body: '动作保持小而慢，疼痛时立即停止。' },
      { title: '轻轻转向两侧', body: '只转到舒服的位置，停一下再回到正中。' },
    ],
    completionTitle: '肩颈已经松开一点',
    completionAction: '把屏幕或座椅调整到更舒服的位置，再继续手边的事。',
  },
  {
    id: 'five-senses',
    title: '五感回到此刻',
    description: '从纷乱想法回到真实环境',
    estimatedSeconds: 90,
    tone: 'mint',
    steps: [
      { title: '找出五种颜色', body: '不用移动位置，只在眼前安静地找五种不同颜色。' },
      { title: '感受四种触感', body: '留意衣物、椅背、桌面和脚下，不必描述给任何人。' },
      { title: '听见三种声音', body: '近处和远处都算，让声音自己来到注意力里。' },
      { title: '带走一次完整呼气', body: '确认自己已经回到这里，然后慢慢呼出一口气。' },
    ],
    completionTitle: '注意力已经回到此刻',
    completionAction: '从现在能控制的一件小事开始，其他想法可以稍后再处理。',
  },
  {
    id: 'water-pause',
    title: '一杯水的暂停',
    description: '用几口水给工作加一个间隔',
    estimatedSeconds: 75,
    tone: 'sky',
    steps: [
      { title: '离开屏幕取一杯水', body: '这一步不顺便处理消息，也不增加新的待办。' },
      { title: '前三口只感受温度', body: '留意水的温度和吞咽动作，让身体接管注意力。' },
      { title: '放下杯子再决定下一步', body: '用一秒确认：现在最值得继续的是哪一件事。' },
    ],
    completionTitle: '短暂停顿已经完成',
    completionAction: '把杯子放在伸手可及的位置，带着清楚的一步回到工作。',
  },
  {
    id: 'desk-reset',
    title: '桌面三件归位',
    description: '用小范围秩序换一点呼吸空间',
    estimatedSeconds: 90,
    tone: 'sun',
    steps: [
      { title: '只选三件东西', body: '找出最碍眼的三件，不扩大成完整整理任务。' },
      { title: '逐件放回固定位置', body: '没有固定位置的，先放进一个临时收纳点。' },
      { title: '三件完成就停', body: '看一眼空出来的范围，允许整理在这里结束。' },
    ],
    completionTitle: '桌面已经空出一小块',
    completionAction: '把接下来要用的唯一物品放到这块空间里，然后开始。',
  },
  {
    id: 'distance-gaze',
    title: '二十秒远眺轮换',
    description: '让眼睛和大脑一起短暂休息',
    estimatedSeconds: 80,
    tone: 'sky',
    steps: [
      { title: '看向六米外', body: '选择远处轮廓清楚的物体，保持大约二十秒。' },
      { title: '闭眼感受光线', body: '不揉眼睛，只感受明暗变化和眼周放松。' },
      { title: '再完成两轮', body: '按自己的节奏在远眺和闭眼之间切换两次。' },
    ],
    completionTitle: '眼睛已经得到一次换焦',
    completionAction: '回来后先调低不必要的亮度，再看屏幕上的一个区域。',
  },
] as const;

export function practiceById(id: EnergyPracticeId): EnergyPracticeDefinition {
  const practice = PRACTICE_CONTENT.find((item) => item.id === id);
  if (!practice) throw new Error(`Unknown energy practice: ${id}`);
  return practice;
}
