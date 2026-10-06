import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Plus, Search } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import type { UiProject } from '@/types/task';
import { taskStatusLabel } from '@/lib/task-status-copy';
import { PageContainer, PageHeader } from '@/pages/PageShell';
import { pageErrorMessage } from '@/lib/page-error-copy';

type Rows = Awaited<ReturnType<typeof trpc.tasks.list.query>>['tasks'];
export function PersonalProjectDetail({ project }: { project: UiProject }) {
  const navigate = useNavigate();
  const requestVersion = useRef(0);
  const [rows, setRows] = useState<Rows>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const version = ++requestVersion.current;
    setRows([]);
    setCursor(null);
    setLoading(true);
    setError('');
    void trpc.tasks.list
      .query({ projectId: project.projectId, limit: 100 })
      .then((result) => {
        if (version === requestVersion.current) {
          setRows(result.tasks);
          setCursor(result.nextCursor);
        }
      })
      .catch((reason) => {
        if (version === requestVersion.current) setError(pageErrorMessage(reason));
      })
      .finally(() => {
        if (version === requestVersion.current) setLoading(false);
      });
    return () => {
      requestVersion.current += 1;
    };
  }, [project.projectId, revision]);
  async function more() {
    if (cursor === null || loading) return;
    const version = requestVersion.current;
    setLoading(true);
    setError('');
    try {
      const result = await trpc.tasks.list.query({
        projectId: project.projectId,
        limit: 100,
        cursor,
      });
      if (version === requestVersion.current) {
        setRows((previous) => [
          ...previous,
          ...result.tasks.filter((item) => !previous.some((row) => row.taskId === item.taskId)),
        ]);
        setCursor(result.nextCursor);
      }
    } catch (reason) {
      if (version === requestVersion.current) setError(pageErrorMessage(reason));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }
  const visible = rows.filter(
    (task) =>
      (tab === 'all' ||
        (tab === 'running' && ['planning', 'executing', 'queued'].includes(task.status)) ||
        (tab === 'waiting' && task.status === 'awaiting_user') ||
        (tab === 'done' && task.status === 'completed')) &&
      `${task.title ?? ''} ${task.intent}`.includes(query),
  );
  return (
    <PageContainer width="workspace" className="hd-personal-project-detail">
      <button className="hd-project-back" type="button" onClick={() => navigate('/projects')}>
        <ChevronLeft />
        全部项目
      </button>
      <PageHeader
        title={project.name}
        description={project.description ?? undefined}
        action={
          <button
            type="button"
            className="hd-project-new-task"
            onClick={() => navigate(`/?project=${encodeURIComponent(project.projectId)}`)}
          >
            <Plus />
            新任务
          </button>
        }
      />
      <div className="hd-project-detail-columns">
        <section>
          <div className="hd-project-task-tabs">
            <div role="tablist" aria-label="项目任务状态">
              {[
                ['all', '全部任务'],
                ['running', '进行中'],
                ['waiting', '待确认'],
                ['done', '已完成'],
              ].map(([id, label]) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  key={id}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label>
              <Search />
              <input
                aria-label="搜索项目任务"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索"
              />
            </label>
          </div>
          {error && (
            <p role="alert" className="hd-project-load-error">
              {error}
              <button type="button" onClick={() => setRevision((value) => value + 1)}>
                重试
              </button>
            </p>
          )}
          {visible.map((task) => (
            <button
              type="button"
              className="hd-project-task-item"
              key={task.taskId}
              data-status={task.status}
              onClick={() => navigate(`/?task=${encodeURIComponent(task.taskId)}`)}
            >
              <i />
              <span>
                <strong>{task.title || task.intent}</strong>
                <small>{task.intent}</small>
              </span>
              <em>{taskStatusLabel(task.status)}</em>
            </button>
          ))}
          {!visible.length && (
            <p className="hd-catalog-empty">{loading ? '正在读取项目任务…' : '暂无匹配的任务'}</p>
          )}
          {cursor && (
            <button
              type="button"
              className="hd-project-load-more"
              disabled={loading}
              onClick={() => void more()}
            >
              {loading ? '加载中…' : '加载更多'}
            </button>
          )}
        </section>
        <aside className="hd-project-info">
          <h2>项目说明</h2>
          <p>{project.description || '还没有添加项目说明。'}</p>
          <h2>参考资料</h2><p>项目资料关联尚未接入，已有文件可在文件库中查看。</p><button type="button" className="hd-project-library-link" onClick={()=>navigate('/files')}>查看文件库</button>
          <h2>项目进展</h2>
          <p>{project.taskCount} 个任务</p>
          <small>更新于 {new Date(project.updatedAt).toLocaleDateString('zh-CN')}</small>
        </aside>
      </div>
    </PageContainer>
  );
}
