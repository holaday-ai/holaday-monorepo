import { Button } from '@/components/ui/button';
import {
  type AstroProfile,
  clearAstroProfile,
  createProfileFromBirthday,
  defaultAstroProfile,
  readAstroProfile,
  saveAstroProfile,
} from '@/lib/astrology';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import * as React from 'react';

interface EnergyProfileDrawerProps {
  open: boolean;
  storageScope: string | null;
  returnFocusRef: React.RefObject<HTMLButtonElement>;
  onOpenChange: (open: boolean) => void;
  onProfileChange: (profile: AstroProfile | null) => void;
}

export function EnergyProfileDrawer({
  open,
  storageScope,
  returnFocusRef,
  onOpenChange,
  onProfileChange,
}: EnergyProfileDrawerProps): JSX.Element {
  const [draft, setDraft] = React.useState<AstroProfile>(defaultAstroProfile);
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [confirmingClear, setConfirmingClear] = React.useState(false);
  const birthdayRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const stored = readAstroProfile(storageScope) ?? defaultAstroProfile();
    setDraft(stored);
    setShowAdvanced(Boolean(stored.birthTime || stored.birthPlace));
    setConfirmingClear(false);
  }, [open, storageScope]);

  const save = (): void => {
    const next = createProfileFromBirthday({
      name: draft.name,
      birthday: draft.birthday,
      birthTime: draft.birthTime,
      birthPlace: draft.birthPlace,
    });
    saveAstroProfile(next, storageScope);
    onProfileChange(next);
    onOpenChange(false);
  };

  const clear = (): void => {
    clearAstroProfile(storageScope);
    onProfileChange(null);
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[94] bg-[#1b171d]/30 backdrop-blur-[1px] data-[state=open]:animate-fade-in motion-reduce:animate-none" />
        <Dialog.Content
          className="fixed inset-y-0 right-0 z-[95] flex w-[min(440px,calc(100vw-12px))] flex-col border-l border-[#e7dfe4] bg-[#fffdfc] shadow-[-24px_0_70px_rgba(52,41,52,0.18)] outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right motion-reduce:animate-none"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            birthdayRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocusRef.current?.focus();
          }}
        >
          <header className="border-b border-[#eee8ec] px-6 py-5 pr-16">
            <Dialog.Title className="text-xl font-semibold tracking-[-0.02em] text-[#332d37]">
              我的能量
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-sm leading-6 text-[#776d78]">
              只在需要个性化星座提示时使用，资料保存在当前账号的本地空间。
            </Dialog.Description>
          </header>

          <Dialog.Close asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-4 top-4 rounded-full text-[#756b77]"
              aria-label="关闭个人资料"
              title="关闭个人资料"
            >
              <X aria-hidden="true" />
            </Button>
          </Dialog.Close>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            <div className="grid gap-5">
              <label className="grid gap-2 text-sm font-medium text-[#49404b]">
                <span className="flex items-center justify-between gap-3">
                  生日
                  <small className="font-normal text-[#978a94]">用于计算星座</small>
                </span>
                <input
                  ref={birthdayRef}
                  type="date"
                  aria-label="生日"
                  value={draft.birthday}
                  className="h-11 rounded-xl border border-[#ddd4da] bg-white px-3 text-sm outline-none focus:border-[#aa6a88] focus:ring-2 focus:ring-[#aa6a88]/15"
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, birthday: event.target.value }))
                  }
                />
              </label>

              {!showAdvanced ? (
                <button
                  type="button"
                  className="justify-self-start rounded-lg text-sm font-medium text-[#85536c] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#aa6a88]"
                  onClick={() => setShowAdvanced(true)}
                >
                  完善星象资料
                </button>
              ) : (
                <div className="grid gap-5 rounded-2xl bg-[#faf6f8] p-4">
                  <p className="m-0 text-xs leading-5 text-[#827681]">
                    出生时间和地点是可选项，只用于补充上升与长期节奏提示。
                  </p>
                  <label className="grid gap-2 text-sm font-medium text-[#49404b]">
                    出生时间
                    <input
                      type="time"
                      value={draft.birthTime}
                      className="h-11 rounded-xl border border-[#ddd4da] bg-white px-3 text-sm outline-none focus:border-[#aa6a88] focus:ring-2 focus:ring-[#aa6a88]/15"
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, birthTime: event.target.value }))
                      }
                    />
                  </label>
                  <label className="grid gap-2 text-sm font-medium text-[#49404b]">
                    出生地点
                    <input
                      type="text"
                      value={draft.birthPlace}
                      placeholder="例如：Tokyo"
                      className="h-11 rounded-xl border border-[#ddd4da] bg-white px-3 text-sm outline-none focus:border-[#aa6a88] focus:ring-2 focus:ring-[#aa6a88]/15"
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, birthPlace: event.target.value }))
                      }
                    />
                  </label>
                </div>
              )}
            </div>

            <div className="mt-7 flex flex-wrap gap-3">
              <Button
                type="button"
                className="rounded-xl bg-[#884f6b] hover:bg-[#76435c]"
                onClick={save}
              >
                保存资料
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="rounded-xl text-[#8b6678]"
                onClick={() => setConfirmingClear(true)}
              >
                清除资料
              </Button>
            </div>

            {confirmingClear ? (
              <div className="mt-5 rounded-2xl border border-[#ead5dc] bg-[#fff6f8] p-4">
                <p className="m-0 text-sm leading-6 text-[#6f5662]">
                  清除后会恢复通用提示，之后仍可重新填写。
                </p>
                <div className="mt-3 flex gap-2">
                  <Button type="button" variant="destructive" size="sm" onClick={clear}>
                    确认清除
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmingClear(false)}
                  >
                    取消
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
