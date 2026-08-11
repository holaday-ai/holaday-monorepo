import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import type { EnergyExperienceDefinition, ExperiencePhase } from './energy-types';

interface ExperiencePlayerProps {
  open: boolean;
  experience: EnergyExperienceDefinition | null;
  phase: ExperiencePhase;
  returnFocusRef: React.RefObject<HTMLButtonElement>;
  onClose: () => void;
  onStart: () => void;
  onReplay: () => void;
  onChooseAnother: () => void;
  children: React.ReactNode;
}

function durationLabel(seconds: number): string {
  if (seconds < 60) return `约 ${seconds} 秒`;
  return `约 ${Math.ceil(seconds / 60)} 分钟`;
}

export function ExperiencePlayer({
  open,
  experience,
  phase,
  returnFocusRef,
  onClose,
  onStart,
  onReplay,
  onChooseAnother,
  children,
}: ExperiencePlayerProps): JSX.Element | null {
  const startRef = React.useRef<HTMLButtonElement>(null);

  if (!experience) return null;

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[90] bg-[#141218]/35 backdrop-blur-[2px] data-[state=open]:animate-fade-in motion-reduce:animate-none" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[91] flex max-h-[min(760px,calc(100dvh-24px))] w-[min(620px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[24px] border border-white/70 bg-[#fffdfb] shadow-[0_28px_90px_rgba(49,40,58,0.24)] outline-none"
          onOpenAutoFocus={(event) => {
            if (phase !== 'intro') return;
            event.preventDefault();
            startRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocusRef.current?.focus();
          }}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            onClose();
          }}
        >
          <div className="flex items-start gap-4 border-b border-[#eee9e5] px-6 py-5 pr-16">
            <div className="min-w-0">
              <Dialog.Title className="text-xl font-semibold tracking-[-0.02em] text-[#2f2933]">
                {experience.title}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm leading-6 text-[#736a76]">
                {durationLabel(experience.estimatedSeconds)} · {experience.description}
              </Dialog.Description>
            </div>
          </div>

          <Dialog.Close asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-4 top-4 rounded-full text-[#756c78]"
              aria-label="关闭体验"
              title="关闭体验"
            >
              <X aria-hidden="true" />
            </Button>
          </Dialog.Close>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            {phase === 'intro' ? (
              <div className="flex min-h-56 flex-col items-center justify-center text-center">
                <p className="max-w-md text-[15px] leading-7 text-[#5f5663]">
                  给自己留一点空白。准备好时再开始，没有标准答案。
                </p>
                <Button ref={startRef} type="button" className="mt-7 min-w-32" onClick={onStart}>
                  开始体验
                </Button>
              </div>
            ) : null}

            {phase === 'active' || phase === 'result' ? children : null}

            {phase === 'error' ? (
              <div className="flex min-h-56 flex-col items-center justify-center text-center">
                <h3 className="text-lg font-semibold text-[#332d36]">刚刚没有完成</h3>
                <p className="mt-2 max-w-sm text-sm leading-6 text-[#746b77]">
                  没关系，可以重新试一次，也可以先换个轻松的玩法。
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  <Button type="button" onClick={onReplay}>
                    重新试试
                  </Button>
                  <Button type="button" variant="outline" onClick={onChooseAnother}>
                    换个玩法
                  </Button>
                </div>
              </div>
            ) : null}

            {phase === 'result' ? (
              <div className="mt-7 flex flex-wrap justify-center gap-3 border-t border-[#eee9e5] pt-5">
                <Button type="button" onClick={onReplay}>
                  再来一次
                </Button>
                <Button type="button" variant="outline" onClick={onChooseAnother}>
                  换个玩法
                </Button>
              </div>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
