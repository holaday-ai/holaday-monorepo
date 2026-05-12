import {
  Clock,
  FolderOpen,
  Home,
  Layers,
  ListPlus,
  Plus,
  Sparkles,
  Star,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Sidebar as SidebarShell,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';

/**
 * Product polish #3 — slim icon rail shown on every authed
 * sub-page (/scheduled, /batch, /files, /projects, /starred,
 * /settings, /skills, /profile, /plan, /billing, /usage, /history,
 * /connections). Gives the user a constant nav surface so secondary
 * pages don't feel like isolated islands.
 *
 * Compared to the workbench's full Sidebar (Sidebar.tsx with task
 * list + context menus + batch mode + UserMenu), this rail keeps
 * only what's useful OUTSIDE the workbench:
 *   - Home button (back to /)
 *   - New-task button (back to / with composer focused; route
 *     handled by WorkbenchApp's empty-state)
 *   - Feature nav rows with route highlight (`data-[active=true]`)
 *
 * Default state: COLLAPSED to icons. Cmd/Ctrl+B from shadcn's
 * SidebarProvider expands it; hover tooltips appear via the
 * `tooltip` prop on each SidebarMenuButton.
 */
const FEATURES: ReadonlyArray<{
  icon: typeof Sparkles;
  label: string;
  href: string;
}> = [
  { icon: Sparkles, label: '专家技能', href: '/skills' },
  { icon: Clock, label: '定时任务', href: '/scheduled' },
  { icon: ListPlus, label: '批量任务', href: '/batch' },
  { icon: FolderOpen, label: '文件库', href: '/files' },
  { icon: Layers, label: '项目', href: '/projects' },
  { icon: Star, label: '收藏', href: '/starred' },
];

export function AppSidebarRail(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <SidebarShell collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border gap-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="返回主页"
              isActive={location.pathname === '/'}
              onClick={() => navigate('/')}
            >
              <Home />
              <span>主页</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="新任务 (/)"
              onClick={() => navigate('/')}
              className="bg-primary text-primary-foreground font-medium hover:bg-primary/90 hover:text-primary-foreground data-[active=true]:bg-primary data-[active=true]:text-primary-foreground"
            >
              <Plus />
              <span>新任务</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {FEATURES.map(({ icon: Icon, label, href }) => {
                const isActive =
                  location.pathname === href ||
                  location.pathname.startsWith(`${href}/`);
                return (
                  <SidebarMenuItem key={label}>
                    <SidebarMenuButton
                      tooltip={label}
                      isActive={isActive}
                      onClick={() => navigate(href)}
                    >
                      <Icon aria-hidden />
                      <span>{label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>{/* footer slot reserved for future quota chip */}</SidebarFooter>
      <SidebarRail />
    </SidebarShell>
  );
}
