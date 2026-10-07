import { useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronRight, X } from 'lucide-react';
import type { VideoAspect } from '@/types/video';
import type { ImageStyleKey } from '@/types/image';
type Idea = { name: string; image: string; prompt: string; aspectRatio: VideoAspect; style?: ImageStyleKey };

export const IMAGE_IDEAS: Idea[] = [
  {
    name: '空间氛围',
    aspectRatio: '16:9',
    style: 'random',
    image: 'interior',
    prompt:
      '一间充满自然光的客厅，奶油白沙发、原木家具和绿植，窗边柔和的阳光，安静舒适的生活氛围。',
  },
  {
    name: '人物肖像',
    aspectRatio: '3:4',
    style: 'portrait',
    image: 'portrait',
    prompt: '海边的自然光人物肖像，轻柔海风、干净的天空与温暖肤色，真实细腻的摄影质感。',
  },
  {
    name: '商品棚拍',
    aspectRatio: '4:3',
    style: 'product',
    image: 'commercial',
    prompt:
      '为一款香水制作精致的夏日商品图，玻璃瓶居中，奶油白与蜜桃橙配色，柔和自然光，保留标题空间。',
  },
  {
    name: '自然光影',
    aspectRatio: '16:9',
    style: 'cinematic',
    image: 'coast',
    prompt: '暮色海岸，低处的海浪与岩石，远处的暖色日落，电影感的光影，安静而开阔。',
  },
];
export const VIDEO_IDEAS: Idea[] = [
  {
    name: '产品短片',
    aspectRatio: '16:9',
    image: 'product',
    prompt:
      '为香水制作一段产品短片。清晨自然光洒在玻璃瓶上，从整体氛围推进到瓶身细节，最后留一个干净的产品画面。',
  },
  {
    name: '生活方式',
    aspectRatio: '9:16',
    image: 'vlog',
    prompt:
      '拍一段山间旅行的生活片段：湖畔晨光、温暖的咖啡、走进山野的背影。镜头轻松自然，像一段值得留住的日常。',
  },
  {
    name: '光影氛围',
    aspectRatio: '16:9',
    image: 'coast',
    prompt: '海岸日落时分，暖色光线掠过岩石，海浪缓慢涌来。镜头轻轻向前，画面安静，有电影感。',
  },
  {
    name: '细节特写',
    aspectRatio: '16:9',
    image: 'detail',
    prompt:
      '近距离拍摄香水瓶的玻璃、金属瓶盖与细小水珠，缓慢移动镜头，干净的背景，细腻真实的材质。',
  },
];
const src = (idea: Idea) =>
  idea.image === 'coast'
    ? '/holaday-ui/coast-dusk.webp'
    : `/holaday-ui/inspiration/${idea.image}.jpg`;
export function CreativeInspiration({
  kind,
  disabled,
  onPick,
}: { kind: 'image' | 'video'; disabled?: boolean; onPick(idea: Idea): void }) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [gallery, setGallery] = useState(false);
  const [selected, setSelected] = useState<Idea | null>(null);
  return (
    <section className="hd-inspiration">
      <div className="hd-inspiration-heading">
        <h2>从一个灵感开始</h2>
        {kind === 'image' ? <span>选一个方向，自由改写</span> : <button
          type="button"
          onClick={(event) => {
            triggerRef.current = event.currentTarget;
            setGallery(true);
          }}
        >
          看全部
          <ChevronRight />
        </button>}
      </div>
      <div className="hd-template-grid">
        {(kind === 'image' ? IMAGE_IDEAS : VIDEO_IDEAS).map((idea) => (
          <button
            key={idea.name}
            type="button"
            className="hd-template-card"
            disabled={disabled}
            onClick={(event) => {
              triggerRef.current = event.currentTarget;
              setSelected(idea);
            }}
          >
            <img src={src(idea)} alt={`${idea.name}示例`} loading="lazy" />
            <strong>{idea.name}</strong>
          </button>
        ))}
      </div>
      <Dialog.Root
        open={!!selected || gallery}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
            setGallery(false);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="hd-creative-overlay" />
          <Dialog.Content
            className="hd-inspiration-dialog"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              triggerRef.current?.focus();
            }}
          >
            <Dialog.Title>{selected?.name ?? '从灵感开始'}</Dialog.Title>
            <Dialog.Close className="hd-dialog-close" title="关闭" aria-label="关闭">
              <X />
            </Dialog.Close>
            {gallery && !selected && (
              <>
                <Dialog.Description className="sr-only">
                  选择一个灵感，填入创作要求后继续调整。
                </Dialog.Description>
                <div className="hd-template-grid">
                  {(kind === 'image' ? IMAGE_IDEAS : VIDEO_IDEAS).map((idea) => (
                    <button
                      type="button"
                      key={idea.name}
                      className="hd-template-card"
                      onClick={() => {
                        onPick(idea);
                        setGallery(false);
                      }}
                    >
                      <img src={src(idea)} alt="" />
                      <strong>{idea.name}</strong>
                    </button>
                  ))}
                </div>
              </>
            )}
            {selected && (
              <>
                <div className="hd-inspiration-detail">
                  <img src={src(selected)} alt={`${selected.name}示例`} />
                  <div>
                    <Dialog.Description>{selected.prompt}</Dialog.Description>
                    <small>示例图片仅作为灵感，不是本次生成结果。</small>
                  </div>
                </div>
                <button
                  className="hd-glass-pill"
                  type="button"
                  onClick={() => {
                    onPick(selected);
                    setSelected(null);
                  }}
                >
                  用这个灵感
                </button>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
