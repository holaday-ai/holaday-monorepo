import { useRef, useState, type ComponentProps } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Paperclip, Pin, Plus, Search, X } from 'lucide-react';
import { SkillLogo } from '@/components/SkillLogo';
import { AttachmentChip } from '@/components/AttachmentChip';
import { CapabilityCenterContent } from './CapabilityCenterContent';
import { groupSkillsByCategory } from '@/lib/skills-page-state';

/** Approved directory and detail drawer, backed by the existing skill handlers. */
export function ApprovedSkillsCatalog(props: ComponentProps<typeof CapabilityCenterContent>) {
  const [tab, setTab] = useState<'discover' | 'common'>('discover');
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const active = props.skills.find((skill) => skill.id === props.activeSkillId);
  const filtered = props.skills.filter(
    (skill) =>
      (tab === 'discover' || skill.enabled) &&
      [
        skill.name,
        skill.description,
        skill.category,
        ...skill.aliases,
        ...skill.experience.starterPrompts,
      ]
        .join(' ')
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
  );
  return (
    <>
      <header className="hd-catalog-heading">
        <div>
          <h1>技能</h1>
          <p>找到适合当前任务的专业能力。</p>
        </div>
        <label className="hd-library-search">
          <Search />
          <input
            aria-label="搜索技能"
            placeholder="搜索技能"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </header>
      <div className="hd-catalog-toolbar">
        <div role="tablist" aria-label="技能目录">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'discover'}
            onClick={() => setTab('discover')}
          >
            发现
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'common'}
            onClick={() => setTab('common')}
          >
            我的常用
          </button>
        </div>
        <span aria-live="polite">{filtered.length} 项技能</span>
      </div>
      {groupSkillsByCategory(filtered).map((group) => (
        <section className="hd-skill-group" key={group.category}>
          <h2>
            {group.category}
            <small>
              {{ 内容运营: '创作与传播', 分析决策: '研究与判断', 管理协作: '规划与执行' }[
                group.category
              ] ?? `${group.items.length} 项技能`}
            </small>
          </h2>
          <div className="hd-skill-grid">
            {group.items.map((skill) => (
              <article className="hd-skill-row" key={skill.id}>
                <button
                  type="button"
                  className="hd-skill-open"
                  onClick={(event) => {
                    returnFocus.current = event.currentTarget;
                    props.onSelectSkill(skill.id);
                    setAdvanced(false);
                    setDetail(true);
                  }}
                >
                  <SkillLogo logoId={skill.logoId} label={skill.name} size="lg" />
                  <span>
                    <strong>{skill.name}</strong>
                    <small>{skill.description}</small>
                  </span>
                </button>
                <button
                  type="button"
                  className="hd-skill-star"
                  aria-pressed={skill.enabled}
                  title={skill.enabled ? '取消固定' : '固定到常用'}
                  aria-label={`${skill.enabled ? '取消固定' : '固定到常用'}：${skill.name}`}
                  disabled={props.pendingId !== null}
                  onClick={() => props.onToggle(skill)}
                >
                  {skill.enabled ? <Pin fill="currentColor" /> : <Plus />}
                </button>
              </article>
            ))}
          </div>
        </section>
      ))}
      {!filtered.length && (
        <p className="hd-catalog-empty">
          {search ? '暂时没有匹配的技能' : '还没有常用技能，在发现里点击 +，把常用技能留在这里。'}
        </p>
      )}
      <footer className="hd-catalog-foot">
        <span>也可以直接描述你想完成的任务。</span>
        <button
          type="button"
          onClick={(event) => {
            returnFocus.current = event.currentTarget;
            setAdvanced(true);
            setDetail(true);
          }}
        >
          描述任务
        </button>
      </footer>
      <Dialog.Root open={detail} onOpenChange={setDetail}>
        <Dialog.Portal>
          <Dialog.Overlay className="hd-skill-detail-overlay" />
          <Dialog.Content
            className={advanced ? 'hd-catalog-dialog' : 'hd-skill-detail'}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              returnFocus.current?.focus();
            }}
          >
            <Dialog.Close
              className="hd-dialog-close"
              title="关闭技能详情"
              aria-label="关闭技能详情"
            >
              <X />
            </Dialog.Close>
            {advanced ? (
              <>
                <Dialog.Title className="sr-only">描述任务</Dialog.Title>
                <Dialog.Description className="sr-only">
                  匹配技能，添加资料并开始任务。
                </Dialog.Description>
                <CapabilityCenterContent {...props} />
              </>
            ) : (
              active && (
                <div className="hd-skill-detail-scroll">
                  <div className="hd-skill-detail-top">
                    <SkillLogo logoId={active.logoId} label={active.name} size="lg" />
                    <button
                      className="hd-skill-star"
                      type="button"
                      title={active.enabled ? '取消固定' : '固定到常用'}
                      aria-pressed={active.enabled}
                      disabled={props.pendingId !== null}
                      onClick={() => props.onToggle(active)}
                    >
                      {active.enabled ? <Pin fill="currentColor" /> : <Plus />}
                    </button>
                  </div>
                  <div className="hd-skill-detail-category">{active.category}</div>
                  <Dialog.Title>{active.name}</Dialog.Title>
                  <Dialog.Description>{active.experience.exampleSummary}</Dialog.Description>
                  <h3>可以这样开始</h3>
                  <div className="hd-skill-examples">
                    {active.experience.starterPrompts.map((prompt, index) => (
                      <button
                        type="button"
                        key={prompt}
                        aria-pressed={props.query === prompt}
                        onClick={() => {
                          props.onQueryChange(prompt);
                          promptRef.current?.focus();
                        }}
                      >
                        <span>0{index + 1}</span>
                        {prompt}
                      </button>
                    ))}
                  </div>
                  <div className="hd-skill-facts">
                    <section>
                      <h3>准备这些资料</h3>
                      <ul>
                        {active.experience.requiredInputs.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </section>
                    <section>
                      <h3>你会得到</h3>
                      <ul>
                        {active.experience.deliverables.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </section>
                  </div>
                  <details className="hd-skill-boundary">
                    <summary>使用说明</summary>
                    <p>{active.experience.boundary}</p>
                  </details>
                  <div className="hd-skill-draft">
                    <textarea
                      ref={promptRef}
                      aria-label="这次任务的要求"
                      placeholder="选择上面的示例，或写下这次的具体要求…"
                      value={props.query}
                      onChange={(event) => props.onQueryChange(event.target.value)}
                    />
                    {props.attachments.map((file, index) => (
                      <AttachmentChip
                        key={file.clientId ?? file.fileId}
                        attachment={file}
                        onRemove={() => props.onRemoveAttachment(index)}
                      />
                    ))}
                  </div>
                  <div className="hd-skill-detail-bottom">
                    {props.attachmentsAllowed ? (
                      <>
                        <input
                          ref={filesRef}
                          type="file"
                          multiple
                          className="sr-only"
                          aria-label="技能任务资料"
                          onChange={(event) => {
                            if (event.target.files) props.onAddAttachments(event.target.files);
                            event.target.value = '';
                          }}
                        />
                        <button
                          type="button"
                          title="添加资料"
                          onClick={() => filesRef.current?.click()}
                        >
                          <Paperclip />
                          添加资料
                        </button>
                      </>
                    ) : (
                      <span>填写这次任务的具体要求</span>
                    )}
                    <button
                      type="button"
                      className="hd-skill-primary"
                      disabled={
                        !props.query.trim() ||
                        props.pendingId !== null ||
                        props.attachments.some((file) => file.status !== 'ready')
                      }
                      onClick={() => props.onStart(active, props.query.trim(), 'manual')}
                    >
                      带入新任务
                    </button>
                  </div>
                </div>
              )
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
