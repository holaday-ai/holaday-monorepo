import { Check, Lightbulb, LockKeyhole, ShoppingBag } from 'lucide-react';
import type { CommercialImageUse, ImageCreationGoal } from '@/types/image';
import { cn } from '@/lib/utils';

const IMAGE_GOALS: ReadonlyArray<{
  id: ImageCreationGoal;
  title: string;
  description: string;
  image: string;
  imagePosition: string;
  tone: string;
  icon: typeof Lightbulb;
}> = [
  {
    id: 'inspiration',
    title: '灵感创作',
    description: '自由发挥，把一个想法变成完整画面',
    image: '/image-style-previews/illustration.png',
    imagePosition: 'object-center',
    tone: 'bg-[#FFF1EA] text-[#C8664C]',
    icon: Lightbulb,
  },
  {
    id: 'lock_subject',
    title: '锁定主角',
    description: '保持主角不变，只改变你想改的部分',
    image: '/image-style-previews/portrait.png',
    imagePosition: 'object-center',
    tone: 'bg-[#EAF4FF] text-[#3678C6]',
    icon: LockKeyhole,
  },
  {
    id: 'commercial',
    title: '商业成片',
    description: '快速制作商品图、海报与社媒封面',
    image: '/image-style-previews/product.png',
    imagePosition: 'object-center',
    tone: 'bg-[#E8F8EE] text-[#34865B]',
    icon: ShoppingBag,
  },
];

const COMMERCIAL_USES: ReadonlyArray<{ id: CommercialImageUse; label: string }> = [
  { id: 'product', label: '商品图' },
  { id: 'poster', label: '海报' },
  { id: 'social_cover', label: '社媒封面' },
];

interface ImageGoalPickerProps {
  value: ImageCreationGoal;
  commercialUse?: CommercialImageUse;
  onChange(value: ImageCreationGoal): void;
  onCommercialUseChange(value: CommercialImageUse): void;
}

export function ImageGoalPicker({
  value,
  commercialUse,
  onChange,
  onCommercialUseChange,
}: ImageGoalPickerProps): JSX.Element {
  return (
    <section className="space-y-4">
      <div>
        <p className="text-sm font-semibold tracking-[0.08em] text-[#8D8291]">图片创作工作台</p>
        <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.03em] text-[#302936] sm:text-[34px]">
          今天想做什么图？
        </h1>
        <p className="mt-2 text-sm leading-6 text-[#746A78]">
          先选目标，HOLA DAY 会帮你配好合适的生成方式。
        </p>
      </div>

      <div role="group" aria-label="今天想做什么图" className="grid gap-3 md:grid-cols-3">
        {IMAGE_GOALS.map((goal) => {
          const selected = goal.id === value;
          const Icon = goal.icon;
          return (
            <button
              key={goal.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(goal.id)}
              className={cn(
                'group relative min-h-[214px] overflow-hidden rounded-[24px] border bg-white text-left shadow-[0_12px_30px_rgba(58,45,64,0.05)] transition duration-200 motion-reduce:transition-none',
                selected
                  ? 'border-[#4B8EEA] ring-2 ring-[#4B8EEA]/15'
                  : 'border-[#E9E1E8] hover:-translate-y-0.5 hover:border-[#CFC3D0] hover:shadow-[0_16px_34px_rgba(58,45,64,0.08)] motion-reduce:hover:translate-y-0',
              )}
            >
              <img
                src={goal.image}
                alt=""
                aria-hidden
                className={cn('h-[132px] w-full object-cover', goal.imagePosition)}
              />
              <span className="flex items-center gap-3 px-4 py-3.5">
                <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl', goal.tone)}>
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-[16px] font-semibold text-[#302936]">
                    {goal.title}
                    {selected ? (
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#4B8EEA] text-white">
                        <Check className="h-3 w-3" aria-hidden />
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-[#766D7B]">{goal.description}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {value === 'commercial' ? (
        <div
          role="group"
          aria-label="选择成片用途"
          className="flex flex-wrap items-center gap-2 rounded-[18px] border border-[#F0DED1] bg-[#FFF8F2] p-2.5"
        >
          <span className="px-2 text-xs font-semibold text-[#8A6A58]">选择成片用途</span>
          {COMMERCIAL_USES.map((use) => {
            const selected = (commercialUse ?? 'product') === use.id;
            return (
              <button
                key={use.id}
                type="button"
                aria-pressed={selected}
                onClick={() => onCommercialUseChange(use.id)}
                className={cn(
                  'min-h-11 rounded-xl border px-4 text-sm font-semibold transition-colors motion-reduce:transition-none',
                  selected
                    ? 'border-[#E9A98B] bg-white text-[#9B553F] shadow-sm'
                    : 'border-transparent text-[#7D6A60] hover:bg-white/70',
                )}
              >
                {use.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
