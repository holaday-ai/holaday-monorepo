/**
 * Phase 16b — MCP provider catalogue (display-only).
 *
 * The /connections page renders this list; clicking a card today
 * just toasts "即将上线". A future batch will add the OAuth flow
 * and persist connection state in a new mcp_connections table —
 * not in this batch's scope.
 *
 * `icon` matches a lucide-react export name; the SPA looks it up
 * via a static lookup map (same pattern as skill-meta.ts).
 */

export type McpCategory = 'productivity' | 'communication' | 'storage' | 'development' | 'social';

export interface McpProvider {
  id: string;
  name: string;
  icon: string;
  description: string;
  category: McpCategory;
  /** Reserved for the OAuth phase. v1 always false. */
  oauthSupported: boolean;
  /** Banner label on the card. v1 always true. */
  comingSoon: boolean;
}

export const MCP_PROVIDERS: readonly McpProvider[] = [
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    icon: 'Calendar',
    description: '日程管理与会议安排',
    category: 'productivity',
    oauthSupported: false,
    comingSoon: true,
  },
  {
    id: 'notion',
    name: 'Notion',
    icon: 'BookOpen',
    description: '笔记与知识库',
    category: 'productivity',
    oauthSupported: false,
    comingSoon: true,
  },
  {
    id: 'airtable',
    name: 'Airtable',
    icon: 'Table',
    description: '结构化数据管理',
    category: 'productivity',
    oauthSupported: false,
    comingSoon: true,
  },
  {
    id: 'gmail',
    name: 'Gmail',
    icon: 'Mail',
    description: '邮件收发与管理',
    category: 'communication',
    oauthSupported: false,
    comingSoon: true,
  },
  {
    id: 'slack',
    name: 'Slack',
    icon: 'MessageSquare',
    description: '团队沟通与协作',
    category: 'communication',
    oauthSupported: false,
    comingSoon: true,
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    icon: 'HardDrive',
    description: '云端文件存储',
    category: 'storage',
    oauthSupported: false,
    comingSoon: true,
  },
  {
    id: 'dropbox',
    name: 'Dropbox',
    icon: 'Box',
    description: '文件同步与分享',
    category: 'storage',
    oauthSupported: false,
    comingSoon: true,
  },
  {
    id: 'github',
    name: 'GitHub',
    icon: 'Github',
    description: '代码仓库与项目管理',
    category: 'development',
    oauthSupported: false,
    comingSoon: true,
  },
  {
    id: 'jira',
    name: 'Jira',
    icon: 'Kanban',
    description: '项目跟踪与任务管理',
    category: 'development',
    oauthSupported: false,
    comingSoon: true,
  },
  {
    id: 'x-twitter',
    name: 'X (Twitter)',
    icon: 'Twitter',
    description: '社交媒体发布与监控',
    category: 'social',
    oauthSupported: false,
    comingSoon: true,
  },
];
