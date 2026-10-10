import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  ChevronDown,
  Clock3,
  FileText,
  Files,
  Layers,
  Loader2,
  Maximize2,
  Minimize2,
  Plus,
  X,
} from 'lucide-react';
import { CreativeReferenceLibrary } from '@/components/CreativeReferenceLibrary';
import type { DraftAttachment } from '@/components/AttachmentChip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { uploadFile, uploadFailureMessage } from '@/lib/upload-file';

export interface StockResearchDraft {
  scope: string;
  period: string;
  output: string;
  citeSources: boolean;
  attachments: DraftAttachment[];
  changed: boolean;
}
/** User-chosen requirements are explicit; untouched drafts retain exact original wording. */
export function stockResearchIntent(value: string, draft?: StockResearchDraft): string {
  if (!draft?.changed) return value;
  return `${value}\n\n研究要求：\n研究范围：${draft.scope}\n时间范围：${draft.period}\n输出内容：${draft.output}\n来源展示：${draft.citeSources ? '展开引用来源及数据日期' : '简洁展示，仍注明事实对应的数据日期'}。缺少所选时段的数据时请明确说明，不将当前快照当成历史序列。`;
}

export function ApprovedStockComposer({
  value,
  placeholder,
  assistantStatus,
  dataDateLabel,
  submitting,
  submitDisabled,
  onValueChange,
  onSubmit,
  onManageWatchlist,
  researchStocks = [],
  commands,
  onCommand,
  isCommandDisabled,
  commandTitle,
}: {
  value: string;
  placeholder: string;
  assistantStatus: string;
  dataDateLabel?: string;
  submitting: boolean;
  submitDisabled: boolean;
  onValueChange(value: string): void;
  onSubmit(draft?: StockResearchDraft): void;
  onManageWatchlist?: () => void;
  researchStocks?: readonly { symbol: string; name: string }[];
  commands: readonly string[];
  onCommand(command: string): void;
  isCommandDisabled: (command: string) => boolean;
  commandTitle: (command: string) => string | undefined;
}) {
  const [collapsed, setCollapsed] = useState(false),
    [expanded, setExpanded] = useState(false);
  const [scope, setScope] = useState('我的关注'),
    [period, setPeriod] = useState('最近交易日'),
    [output, setOutput] = useState('要点摘要');
  const [citeSources, setCiteSources] = useState(true),
    [changed, setChanged] = useState(false);
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]),
    [uploading, setUploading] = useState(false),
    [uploadError, setUploadError] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const libraryAnchor = useRef<HTMLButtonElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const blocked = submitDisabled || submitting || uploading;
  const send = () => {
    if (!blocked) onSubmit({ scope, period, output, citeSources, attachments, changed });
  };
  const add = (file: DraftAttachment) =>
    setAttachments((previous) =>
      previous.length >= 5 || previous.some((item) => item.fileId === file.fileId)
        ? previous
        : [...previous, file],
    );
  async function upload(files: FileList | null) {
    if (!files || uploading || submitting) return;
    setUploading(true);
    setUploadError('');
    try {
      for (const file of Array.from(files).slice(0, 5 - attachments.length)) {
        const uploaded = await uploadFile(file);
        if (!alive.current) return;
        add({ ...uploaded, status: 'ready' });
      }
    } catch (error) {
      if (alive.current) setUploadError(uploadFailureMessage(error));
    } finally {
      if (alive.current) setUploading(false);
    }
  }
  return (
    <section
      className="hd-approved-stock-composer"
      aria-label="Holaday AI 股市研究助手"
      data-approved
      data-collapsed={collapsed}
      data-expanded={expanded}
    >
      <div className="hd-stock-dock-meta">
        <ResearchMenu
          title="选择研究范围"
          value={scope}
          onChange={(next) => {
            setScope(next);
            setChanged(true);
          }}
          options={[
            '我的关注',
            '整个市场',
            ...researchStocks.map((stock) => `${stock.name} · ${stock.symbol}`),
          ]}
          icon={<Layers />}
          footer={
            onManageWatchlist ? (
              <DropdownMenuItem onSelect={onManageWatchlist}>管理关注股票</DropdownMenuItem>
            ) : undefined
          }
        />
        <ResearchMenu
          title="选择时间范围"
          value={period}
          onChange={(next) => {
            setPeriod(next);
            setChanged(true);
          }}
          options={['最近交易日', '近 5 个交易日', '近 20 个交易日']}
          icon={<Clock3 />}
        />
        <button
          type="button"
          className="hd-dock-collapse"
          title={collapsed ? '展开输入框' : '收起输入框'}
          aria-label={collapsed ? '展开输入框' : '收起输入框'}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((current) => !current)}
        >
          <ChevronDown />
        </button>
      </div>
      <div
        className="hd-stock-dock-fold"
        aria-hidden={collapsed}
        {...(collapsed ? { inert: '' } : {})}
      >
        <div>
          <form
            className="hd-stock-research-form"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            <div className="hd-stock-source">
              <button
                type="button"
                ref={libraryAnchor}
                title="选择参考资料"
                onClick={() => setLibraryOpen(true)}
                disabled={submitting || uploading}
              >
                <Files />
                参考资料
              </button>
              <span title={assistantStatus}>行情快照 {dataDateLabel ?? '待核验'}</span>
              <small>A 股</small>
            </div>
            {!!attachments.length && (
              <div className="hd-stock-attachments" aria-label="已选参考资料">
                {attachments.map((file) => (
                  <span key={file.fileId}>
                    <FileText />
                    {file.filename}
                    <button
                      type="button"
                      title="移除参考资料"
                      aria-label={`移除${file.filename}`}
                      onClick={() =>
                        setAttachments((previous) =>
                          previous.filter((item) => item.fileId !== file.fileId),
                        )
                      }
                      disabled={submitting}
                    >
                      <X />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <textarea
              aria-label="交代股市研究任务"
              placeholder={placeholder}
              value={value}
              onChange={(event) => onValueChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  send();
                }
              }}
              rows={2}
            />
            {uploadError && (
              <p role="alert" className="hd-stock-upload-error">
                {uploadError}。可重新选择文件重试。
              </p>
            )}
            <div className="hd-stock-compose-toolbar">
              <div>
                <button
                  type="button"
                  className="hd-stock-add"
                  title="添加本地资料"
                  aria-label="添加本地资料"
                  onClick={() => fileInput.current?.click()}
                  disabled={submitting || uploading || attachments.length >= 5}
                >
                  {uploading ? <Loader2 className="animate-spin" /> : <Plus />}
                </button>
                <button
                  type="button"
                  className="hd-stock-citations"
                  aria-pressed={citeSources}
                  title={citeSources ? '已开启引用来源，点击关闭' : '开启引用来源'}
                  onClick={() => {
                    setCiteSources((current) => !current);
                    setChanged(true);
                  }}
                >
                  <FileText />
                  引用来源
                </button>
                <ResearchMenu
                  title="选择输出内容"
                  value={output}
                  options={['要点摘要', '对比表格', '完整报告']}
                  onChange={(next) => {
                    setOutput(next);
                    setChanged(true);
                  }}
                />
              </div>
              <div className="hd-stock-compose-send">
                <span>Enter 发送</span>
                <button
                  type="button"
                  title={expanded ? '收起编辑' : '展开编辑'}
                  aria-label={expanded ? '收起编辑' : '展开编辑'}
                  aria-expanded={expanded}
                  onClick={() => setExpanded((current) => !current)}
                >
                  {expanded ? <Minimize2 /> : <Maximize2 />}
                </button>
                <button
                  type="submit"
                  className="hd-stock-send"
                  aria-label="提交股市任务"
                  title="准备研究任务"
                  disabled={blocked}
                >
                  {submitting ? <Loader2 className="animate-spin" /> : <ArrowUp />}
                </button>
              </div>
            </div>
          </form>
          <details className="hd-stock-quick-research">
            <summary>研究建议</summary>
            <div role="group" aria-label="AI 研究建议">
              {commands.map((command) => (
                <button
                  key={command}
                  type="button"
                  disabled={isCommandDisabled(command)}
                  title={commandTitle(command) ?? command}
                  onClick={() => onCommand(command)}
                >
                  {command}
                </button>
              ))}
            </div>
          </details>
        </div>
      </div>
      <input
        type="file"
        multiple
        hidden
        ref={fileInput}
        accept=".pdf,.csv,.xlsx,.xls,.txt,.docx,.png,.jpg,.jpeg"
        onChange={(event) => {
          void upload(event.target.files);
          event.target.value = '';
        }}
      />
      <CreativeReferenceLibrary
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        anchorRef={libraryAnchor}
        disabled={submitting || uploading || attachments.length >= 5}
        selectedFileIds={attachments.map((file) => file.fileId)}
        onPick={add}
        onChooseLocal={() => fileInput.current?.click()}
        theme="light"
        fileType="all"
      />
    </section>
  );
}
function ResearchMenu({
  title,
  value,
  onChange,
  options,
  icon,
  footer,
}: {
  title: string;
  value: string;
  onChange(value: string): void;
  options: readonly string[];
  icon?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" title={title}>
          {icon}
          {value}
          <ChevronDown />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="hd-stock-choice-menu" side="top" align="start" sideOffset={8}>
        <DropdownMenuLabel>{title}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {options.map((option) => (
            <DropdownMenuRadioItem value={option} key={option}>
              {option}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {footer}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
