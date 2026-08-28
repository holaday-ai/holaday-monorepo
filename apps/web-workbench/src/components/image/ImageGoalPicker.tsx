import { cn } from '@/lib/utils';
import type { CommercialImageUse, ImageCreationGoal } from '@/types/image';
import { Check, Lightbulb, LockKeyhole, ShoppingBag } from 'lucide-react';

const IMAGE_GOALS: ReadonlyArray<{
  id: ImageCreationGoal;
  title: string;
  description: string;
  image: string;
  imagePosition: string;
  tone: string;
  selectedTone: string;
  checkTone: string;
  icon: typeof Lightbulb;
}> = [
  {
    id: 'inspiration',
    title: '灵感创作',
    description: '自由发挥，把一个想法变成完整画面',
    image: '/design-ref/image-goal-inspiration.jpg',
    imagePosition: 'object-center',
    tone: 'bg-[#FFF1EA] text-[#C8664C]',
    selectedTone: 'border-[#EBA083] bg-[#FFFCFA] ring-[#F1B49D]/20',
    checkTone: 'bg-[#E98F72]',
    icon: Lightbulb,
  },
  {
    id: 'lock_subject',
    title: '锁定主角',
    description: '保持主角不变，只改变你想改的部分',
    image: '/design-ref/image-goal-lock-subject.jpg',
    imagePosition: 'object-center',
    tone: 'bg-[#EAF4FF] text-[#3678C6]',
    selectedTone: 'border-[#72A9E9] bg-[#FBFDFF] ring-[#8FBAEB]/20',
    checkTone: 'bg-[#5E9DE4]',
    icon: LockKeyhole,
  },
  {
    id: 'commercial',
    title: '商业成片',
    description: '快速制作商品图、海报与社媒封面',
    image: '/design-ref/image-goal-commercial.jpg',
    imagePosition: 'object-center',
    tone: 'bg-[#EAF8EE] text-[#4F9468]',
    selectedTone: 'border-[#82C79A] bg-[#FCFFFD] ring-[#98D5AC]/20',
    checkTone: 'bg-[#63B27E]',
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
    <section>
      <h2 className="text-xl font-semibold tracking-[-0.025em] text-[#312A37] sm:text-[24px]">
        今天想做什么图？
      </h2>

      <fieldset
        aria-label="今天想做什么图"
        className="mt-8 grid min-w-0 gap-3 border-0 p-0 sm:grid-cols-3"
      >
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
                'group relative min-h-[220px] overflow-hidden rounded-[20px] border bg-white text-left shadow-[0_8px_22px_rgba(58,45,64,0.045)] transition duration-200 motion-reduce:transform-none motion-reduce:transition-none',
                selected
                  ? cn('ring-2', goal.selectedTone)
                  : 'border-[#E9E1E8] hover:-translate-y-0.5 hover:border-[#CFC3D0] hover:shadow-[0_16px_34px_rgba(58,45,64,0.08)] motion-reduce:hover:translate-y-0',
              )}
            >
              <img
                src={goal.image}
                alt=""
                aria-hidden
                className={cn('h-[140px] w-full object-cover', goal.imagePosition)}
              />
              {selected ? (
                <span
                  className={cn(
                    'absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full border-2 border-white text-white shadow-[0_3px_10px_rgba(41,70,106,0.22)]',
                    goal.checkTone,
                  )}
                >
                  <Check className="h-4 w-4" aria-hidden />
                </span>
              ) : null}
              <span className="flex items-center gap-3 px-4 py-3.5">
                <span
                  className={cn(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl',
                    goal.tone,
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-[16px] font-semibold text-[#302936]">
                    {goal.title}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-[#766D7B]">
                    {goal.description}
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </fieldset>

      {value === 'commercial' ? (
        <fieldset
          aria-label="选择成片用途"
          className="mt-4 flex min-w-0 flex-wrap items-center gap-2 rounded-[18px] border border-[#F0DED1] bg-[#FFF8F2] p-2.5"
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
        </fieldset>
      ) : null}
    </section>
  );
}
