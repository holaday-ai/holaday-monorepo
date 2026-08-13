import type { EnergyPollId } from '../energy-content-target';

export interface EnergyPollOption {
  id: string;
  label: string;
  interpretation: string;
  suggestion: string;
}

export interface EnergyPollDefinition {
  id: EnergyPollId;
  title: string;
  prompt: string;
  options: readonly EnergyPollOption[];
}

export const POLL_CONTENT: readonly EnergyPollDefinition[] = [
  {
    id: 'break-style',
    title: '最有效的休息',
    prompt: '今天哪一种方式最能让你从工作里切换出来？',
    options: [
      {
        id: 'quiet-eyes',
        label: '闭眼安静',
        interpretation: '你现在更需要减少输入。',
        suggestion: '把屏幕放下两分钟，只保留自然环境声。',
      },
      {
        id: 'walk-stretch',
        label: '走动伸展',
        interpretation: '身体活动更容易带走紧绷。',
        suggestion: '离开座位走一小圈，再做一次肩膀后绕。',
      },
      {
        id: 'one-song',
        label: '听一首歌',
        interpretation: '清楚的开始和结束能帮助你转场。',
        suggestion: '只选一首歌，结束后再决定下一步。',
      },
      {
        id: 'short-chat',
        label: '找人聊聊',
        interpretation: '低压力连接可能为你补充能量。',
        suggestion: '发一条无需即时回复的轻问候。',
      },
    ],
  },
  {
    id: 'focus-sound',
    title: '专注背景声',
    prompt: '今天愿意把哪一种声音放进工作背景？',
    options: [
      {
        id: 'full-quiet',
        label: '完全安静',
        interpretation: '你更适合减少刺激后进入状态。',
        suggestion: '关闭一个通知来源，先专注十分钟。',
      },
      {
        id: 'white-noise',
        label: '白噪声',
        interpretation: '稳定、可预测的声音能帮你屏蔽干扰。',
        suggestion: '音量保持在不会盖过环境提醒的程度。',
      },
      {
        id: 'instrumental',
        label: '纯音乐',
        interpretation: '有结构但没有歌词的节奏更适合你。',
        suggestion: '选一张熟悉的纯音乐专辑，不频繁切歌。',
      },
      {
        id: 'cafe-sound',
        label: '咖啡馆环境音',
        interpretation: '一点柔和人声能减少独自工作的沉闷。',
        suggestion: '把它当作背景，不同时打开真实聊天窗口。',
      },
    ],
  },
  {
    id: 'small-reward',
    title: '完成后的奖励',
    prompt: '结束一件任务后，你现在最想给自己什么？',
    options: [
      {
        id: 'favorite-drink',
        label: '喜欢的饮品',
        interpretation: '你需要一个有感官温度的结束标记。',
        suggestion: '完成当前小目标后，离开屏幕慢慢喝几口。',
      },
      {
        id: 'leave-seat',
        label: '离开座位',
        interpretation: '身体转场比继续坐着更能确认完成。',
        suggestion: '站起来走到另一个空间，再回来开始下一项。',
      },
      {
        id: 'light-content',
        label: '看点轻松内容',
        interpretation: '短暂的趣味能帮你释放持续专注。',
        suggestion: '只看一个明确可结束的内容，再回到页面。',
      },
      {
        id: 'cross-it-out',
        label: '划掉待办',
        interpretation: '看见完成证据本身就能补充动力。',
        suggestion: '划掉这一项，并写下下一步的唯一入口。',
      },
    ],
  },
  {
    id: 'social-battery',
    title: '社交电量',
    prompt: '现在更适合哪一种连接距离？',
    options: [
      {
        id: 'lively-chat',
        label: '热闹聊天',
        interpretation: '你还有余量享受多人互动。',
        suggestion: '给聊天设一个自然结束点，保留后面的安静时间。',
      },
      {
        id: 'one-to-one',
        label: '一对一交流',
        interpretation: '你更需要稳定、专注的回应。',
        suggestion: '选择一位让你放松的人，聊一个具体小话题。',
      },
      {
        id: 'essential-only',
        label: '只回必要消息',
        interpretation: '你正在保护有限的社交能量。',
        suggestion: '为其他消息留一个稍后统一回复的时间。',
      },
      {
        id: 'quiet-alone',
        label: '安静独处',
        interpretation: '独处是你此刻合理的恢复方式。',
        suggestion: '给自己十分钟不解释、不回应的安静空间。',
      },
    ],
  },
] as const;

export function pollById(id: EnergyPollId): EnergyPollDefinition {
  const poll = POLL_CONTENT.find((item) => item.id === id);
  if (!poll) throw new Error(`Unknown energy poll: ${id}`);
  return poll;
}

export function isEnergyPollOptionId(pollId: EnergyPollId, optionId: unknown): optionId is string {
  return (
    typeof optionId === 'string' &&
    POLL_CONTENT.some(
      (poll) => poll.id === pollId && poll.options.some((option) => option.id === optionId),
    )
  );
}
