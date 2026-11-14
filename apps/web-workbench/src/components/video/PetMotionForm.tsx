import { useToast } from '@/components/ui/toast';
import { uploadFailureMessage, uploadFile } from '@/lib/upload-file';
import { useTaskStore } from '@/stores/task-store';
import * as React from 'react';

/** Existing Wan image-to-video lane; it does not need a human reference clip. */
export function PetMotionForm({
  onTaskCreated,
}: { onTaskCreated(taskId: string): void }): JSX.Element {
  const createTask = useTaskStore((s) => s.createTask);
  const toast = useToast();
  const [photo, setPhoto] = React.useState<{ fileId: string; name: string } | null>(null);
  const [prompt, setPrompt] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const guard = React.useRef(false);
  async function pick(file?: File) {
    if (!file || guard.current) return;
    if (!/^image\/(png|jpeg|webp)$/i.test(file.type) || file.size > 5 * 1024 * 1024) {
      toast.show('请上传不超过 5 MB 的 JPG / PNG / WebP 宠物照片', 'error');
      return;
    }
    guard.current = true;
    setBusy(true);
    try {
      const uploaded = await uploadFile(file);
      setPhoto({ fileId: uploaded.fileId, name: uploaded.filename });
    } catch (e) {
      toast.show(uploadFailureMessage(e), 'error');
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  async function quote() {
    if (!photo || !prompt.trim() || guard.current) return;
    guard.current = true;
    setBusy(true);
    try {
      const result = await createTask(
        prompt.trim(),
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          tab: 'pet',
          petModel: 'wan_i2v',
          petImageFileId: photo.fileId,
          durationSeconds: 5,
          resolution: '1080p',
          aspectRatio: '9:16',
        },
      );
      if ('error' in result) toast.show(result.error, 'error');
      else onTaskCreated(result.taskId);
    } catch (e) {
      toast.show(uploadFailureMessage(e), 'error');
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4" aria-label="宠物动态视频">
      <h2 className="text-lg font-medium">让你的宠物动起来</h2>
      <p className="text-sm text-muted-foreground">
        上传一张宠物照片，描述动作。Wan 图生视频 · 5 秒 · 9:16 · 1080p。确认报价后才开始制作。
      </p>
      <label className="block text-sm">
        宠物照片
        <input
          type="file"
          aria-label="宠物照片"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            void pick(file);
          }}
        />
      </label>
      {photo && <p className="text-sm">{photo.name}</p>}
      <label className="block text-sm">
        宠物动作
        <textarea
          className="mt-2 w-full rounded-md border bg-transparent p-3"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="例如：橘猫轻轻抬起前爪，保持原来的毛色和脸部特征"
          disabled={busy}
        />
      </label>
      <button
        className="rounded-md bg-[#FF0061] px-4 py-2 text-white disabled:opacity-50"
        type="button"
        disabled={busy || !photo || !prompt.trim()}
        onClick={() => void quote()}
      >
        {busy ? '处理中…' : '获取宠物视频报价'}
      </button>
    </section>
  );
}
