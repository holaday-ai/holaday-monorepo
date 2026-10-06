import type { CommercialImageUse, ImageCreationGoal } from '@/types/image';
interface ImageGoalPickerProps { value: ImageCreationGoal; commercialUse?: CommercialImageUse; disabled?: boolean; onChange(value: ImageCreationGoal): void; onCommercialUseChange(value: CommercialImageUse): void }
export function ImageGoalPicker({ value, commercialUse, disabled, onChange, onCommercialUseChange }: ImageGoalPickerProps) {
  const goals = [{id:'inspiration',title:'灵感创作'},{id:'lock_subject',title:'锁定主角'},{id:'commercial',title:'商业成片'}] as const;
  return <>
    <div className="hd-creative-tabs" role="tablist" aria-label="今天想做什么图" style={{ '--active-tab': goals.findIndex(goal => goal.id === value) } as React.CSSProperties}>
      {goals.map(goal => <button key={goal.id} type="button" className="motion-reduce:transition-none motion-reduce:transform-none" role="tab" aria-selected={goal.id === value} aria-controls="image-creative-stage" disabled={disabled} onClick={() => onChange(goal.id)}>{goal.title}</button>)}
    </div>
    {value === 'commercial' && <fieldset aria-label="选择成片用途" className="hd-commercial-uses"><legend>这次，画面用在哪里？</legend>{([{id:'product',label:'商品图',image:'commercial',note:'突出产品与材质'},{id:'poster',label:'海报',image:'detail',note:'让一句表达成为主角'},{id:'social_cover',label:'社媒封面',image:'interior',note:'先让人停下来看看'}] as const).map(use => <button key={use.id} type="button" aria-label={use.label} title={use.label} aria-pressed={(commercialUse ?? 'product') === use.id} disabled={disabled} onClick={() => onCommercialUseChange(use.id)}><img src={`/holaday-ui/inspiration/${use.image}.jpg`} alt="" /><span><strong>{use.label}</strong><small>{use.note}</small></span></button>)}</fieldset>}
  </>;
}
