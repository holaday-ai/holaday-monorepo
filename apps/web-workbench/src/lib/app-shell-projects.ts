import { normalizeProjectRows } from '@/lib/project-page-state';
import type { AppRouter } from '@/lib/trpc';
import type { UiProject } from '@/types/task';
import type { inferRouterClient } from '@trpc/client';

type ProjectsListQuery = inferRouterClient<AppRouter>['projects']['list']['query'];

export async function loadAppShellPersonalProjects(query: ProjectsListQuery): Promise<UiProject[]> {
  const list = await query();
  return normalizeProjectRows(list).filter((project) => project.scope === 'personal');
}
