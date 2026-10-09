export const SEED_VERSION = '2026-10-09-v1';
const at = '2026-10-09T10:00:00.000Z';
export function createSeed() {
  const statuses = ['executing', 'completed', 'failed', 'awaiting_user', 'cancelled'];
  const tasks = [];
  for (const mode of ['generate', 'browser', 'scrape', 'image'])
    for (const status of statuses) {
      const taskId = `tsk_ui_${mode}_${status}`;
      tasks.push({
        taskId,
        title: `UI ${mode} ${status}`,
        intent:
          mode === 'browser'
            ? '查看示例网站'
            : mode === 'scrape'
              ? '分析贵州茅台公开数据'
              : mode === 'image'
                ? '生成测试图片'
                : '写一份测试报告',
        status,
        createdAt: at,
        updatedAt: at,
        tickCount: status === 'executing' ? 2 : 5,
        starred: status === 'completed',
        projectId: null,
        executionId: `exec_${taskId}`,
        executionRevision: 1,
        recordVersion: 1,
        executionMode: mode,
        awaitingKind: mode === 'browser' ? 'login' : 'clarification',
        result: {
          summary:
            status === 'completed'
              ? '已完成本地种子报告。[资料来源](https://example.com/report)'
              : '',
          executionMode: mode,
          metadata: { executionMode: mode, attachments: [] },
          ...(mode === 'browser' && ['completed', 'failed', 'cancelled'].includes(status)
            ? {
                finalScreenshot:
                  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0u8AAAAASUVORK5CYII=',
                finalUrl: 'https://example.com',
                finalViewport: { width: 1440, height: 900 },
              }
            : {}),
        },
        errorMessage:
          status === 'failed'
            ? mode === 'browser'
              ? 'net::ERR_NAME_NOT_RESOLVED'
              : mode === 'image'
                ? 'image provider timeout'
                : mode === 'scrape'
                  ? 'search timeout'
                  : '429 rate limit exceeded'
            : null,
        steps:
          mode === 'browser'
            ? Array.from({ length: 12 }, (_, i) => ({
                seq: i,
                kind: 'navigate',
                status: 'done',
                input: { summary: `查看本地页面 ${i + 1}` },
                output: { durationMs: 50 },
                startedAt: at,
              }))
            : mode === 'scrape'
              ? [
                  {
                    seq: 0,
                    kind: 'web_search',
                    status: 'done',
                    input: { summary: '检索市场新闻' },
                    output: {
                      webSearches: [
                        {
                          query: '本地市场新闻',
                          sources: [
                            {
                              title: 'eastmoney:stock-news-search',
                              url: 'https://example.com/news',
                              snippet: '仅本地来源展示测试',
                            },
                          ],
                        },
                      ],
                    },
                    startedAt: at,
                  },
                ]
              : [],
        verificationPassed: status === 'completed' ? null : undefined,
      });
    }
  return {
    tasks,
    memories: [
      {
        externalId: 'mem_ui',
        category: 'preference',
        keyName: '报告偏好',
        value: '使用简洁中文和表格。仅本地合成测试数据。',
        expiresAt: null,
        updatedAt: at,
      },
    ],
    watchlist: [
      {
        symbol: '600519',
        name: '贵州茅台',
        displayName: '贵州茅台',
        exchange: 'SH',
        market: 'A',
        note: '本地种子',
        createdAt: at,
      },
    ],
    briefingEnabled: false,
    apiKeys: [],
    scheduled: [],
    projects: [
      { ...project },
      {
        ...project,
        projectId: 'prj_personal',
        id: 'prj_personal',
        scope: 'personal',
        organizationId: null,
        organizationName: null,
      },
    ],
    organizations: [
      {
        organizationId: 'org_ui',
        name: '本地测试团队',
        role: 'owner',
        managerDisplayName: null,
        activeMemberCount: 2,
      },
    ],
    members: [
      {
        organizationId: 'org_ui',
        memberId: 'om_ui',
        userId: 'usr_ui',
        displayName: 'UI 测试用户',
        avatarUrl: null,
        role: 'owner',
        managerUserId: null,
        managerDisplayName: null,
        status: 'active',
      },
      {
        organizationId: 'org_ui',
        memberId: 'om_other',
        userId: 'usr_other',
        displayName: '测试成员',
        avatarUrl: null,
        role: 'member',
        managerUserId: null,
        managerDisplayName: null,
        status: 'active',
      },
    ],
    notifications: Array.from({ length: 188 }, (_, i) => ({
      id: i + 1,
      notificationId: i + 1,
      title: `测试通知 ${i + 1}`,
      body: '仅本地种子通知',
      type: 'task_completed',
      readAt: null,
      createdAt: at,
      taskId: tasks[1].taskId,
    })),
    requests: [],
    unhandled: [],
  };
}
const profile = {
  userId: 'usr_ui',
  email: 'ui@example.test',
  phone: null,
  displayName: 'UI 测试用户',
  plan: 'pro',
  role: 'admin',
  multiUser: true,
  selectedRoles: [],
  videoEnabled: true,
  teamProjectsEnabled: true,
  teamTaskLifecycleEnabled: true,
  modelDataRegion: 'cn',
  quota: { dailyLimit: 100, usedToday: 2, remaining: 98 },
  createdAt: at,
};
const project = {
  projectId: 'prj_ui',
  id: 'prj_ui',
  name: '测试项目',
  description: '本地种子',
  scope: 'organization',
  organizationId: 'org_ui',
  organizationName: '本地测试团队',
  memberRole: 'lead',
  updatedAt: at,
  createdAt: at,
  taskCount: 2,
};
const file = {
  fileId: 'fil_ui',
  id: 'fil_ui',
  name: '测试资料.txt',
  filename: '测试资料.txt',
  mimeType: 'text/plain',
  size: 120,
  createdAt: at,
  expiresAt: '2099-01-01T00:00:00.000Z',
  status: 'ready',
  purpose: 'attachment',
};
const plan = {
  plannedTaskId: 'pln_ui',
  title: '每日测试计划',
  instruction: '检查本地测试数据',
  notes: null,
  scope: 'single',
  items: ['检查数据'],
  itemCount: 1,
  repeatType: 'daily',
  rrule: null,
  firstRunAt: at,
  endsAt: null,
  endsOn: null,
  nextRunAt: at,
  timezone: 'Asia/Shanghai',
  reminderMinutes: null,
  status: 'active',
  lastRunAt: null,
  lastRunStatus: null,
  lastError: null,
  createdAt: at,
  updatedAt: at,
};
export function dispatch(s, name, input = {}, method = 'GET') {
  s.requests.push({ name, method });
  switch (name) {
    case 'auth.me':
      return { ...profile };
    case 'auth.loginOptions':
      return { emailCode: true, sms: true, google: false };
    case 'tasks.localChromeTabs':
      return {
        tabs: [],
        connected: false,
        unavailable: false,
        needsUpdate: false,
        routingV2: false,
      };
    case 'tasks.wakeBrowser':
      return { status: 'unavailable', reason: 'pool_disabled' };
    case 'auth.assignModelDataRegion':
      return { ...profile, modelDataRegion: input.region };
    case 'auth.sendPasswordChangeCode':
      return { ok: true, cooldownMs: 60000 };
    case 'auth.changePasswordWithCode':
    case 'auth.verifyMfaChallenge':
    case 'auth.disableMfa':
      return { accessToken: 'ui-local-seed', user: profile };
    case 'auth.beginMfaSetup':
      return {
        secret: 'SYNTHETIC-NOT-A-CREDENTIAL',
        otpauthUri: 'otpauth://totp/LocalUITest?secret=SYNTHETIC',
      };
    case 'auth.confirmMfaSetup':
    case 'auth.regenerateMfaRecoveryCodes':
      return { accessToken: 'ui-local-seed', recoveryCodes: ['SYNTHETIC-RECOVERY-NOT-VALID'] };
    case 'auth.mfaStatus':
      return { enabled: false, recoveryCodesRemaining: 0 };
    case 'auth.login':
    case 'auth.verifyCode':
    case 'auth.smsVerify':
    case 'auth.register':
      return { accessToken: 'ui-local-seed', user: profile };
    case 'auth.sendCode':
    case 'auth.smsSend':
    case 'auth.resetPassword':
      return { ok: true };
    case 'auth.logout':
    case 'auth.logoutAll':
      return { ok: true };
    case 'tasks.list': {
      const offset = Number(input.cursor ?? 0);
      const limit = Math.min(input.limit ?? 50, 8);
      const rows = s.tasks.filter((t) => !input.starred || t.starred);
      return {
        tasks: rows.slice(offset, offset + limit),
        nextCursor: offset + limit < rows.length ? offset + limit : null,
      };
    }
    case 'tasks.detail':
      return s.tasks.find((t) => t.taskId === input.taskId) ?? s.tasks[0];
    case 'tasks.unsuccessfulCount':
      return { count: s.tasks.filter((t) => ['failed', 'cancelled'].includes(t.status)).length };
    case 'tasks.rename': {
      const t = s.tasks.find((t) => t.taskId === input.taskId);
      if (t) t.title = input.title;
      return { ok: true };
    }
    case 'tasks.star': {
      const t = s.tasks.find((t) => t.taskId === input.taskId);
      if (t) t.starred = input.starred;
      return { ok: true };
    }
    case 'tasks.delete':
      s.tasks = s.tasks.filter((t) => t.taskId !== input.taskId);
      return { ok: true };
    case 'tasks.abort': {
      const t = s.tasks.find((t) => t.taskId === input.taskId);
      if (t) t.status = 'cancelled';
      return { ok: true, state: 'cancelled' };
    }
    case 'tasks.create': {
      const t = {
        ...s.tasks[1],
        taskId: `tsk_ui_created_${s.tasks.length}`,
        intent: input.intent,
        title: null,
      };
      s.tasks.unshift(t);
      return { taskId: t.taskId, executionMode: 'generate', status: 'completed' };
    }
    case 'tasks.reply':
    case 'tasks.moveToProject':
    case 'tasks.clearUnsuccessful':
      return { ok: true, count: 0 };
    case 'tasks.browserControlState':
      return { controlMode: 'agent', owner: 'agent', userTakeover: false, available: false };
    case 'projects.list':
      return s.projects.filter((p) =>
        input.organizationId ? p.organizationId === input.organizationId : p.scope === 'personal',
      );
    case 'projects.detail':
    case 'projects.get':
      return { ...project, tasks: s.tasks.slice(0, 2), members: [], files: [file] };
    case 'projects.create': {
      const row = {
        ...project,
        projectId: `prj_local_${s.projects.length}`,
        name: input.name,
        scope: input.organizationId ? 'organization' : 'personal',
        organizationId: input.organizationId ?? null,
      };
      s.projects.push(row);
      return row;
    }
    case 'projects.delete':
      return { ok: true };
    case 'notifications.unreadCount':
      return { count: s.notifications.filter((n) => !n.readAt).length };
    case 'notifications.list': {
      const offset = Number(input.cursor ?? 0);
      return {
        items: s.notifications.slice(offset, offset + 8),
        notifications: s.notifications.slice(offset, offset + 8),
        nextCursor: offset + 8 < s.notifications.length ? offset + 8 : null,
      };
    }
    case 'notifications.markAllRead':
      for (const n of s.notifications) n.readAt = at;
      return { ok: true };
    case 'notifications.markRead':
      for (const n of s.notifications) {
        if (n.id === input.id || n.notificationId === input.notificationId) n.readAt = at;
      }
      return { ok: true };
    case 'files.list': {
      const image = {
        ...file,
        fileId: 'fil_image_ui',
        id: 'fil_image_ui',
        name: '测试图片.png',
        filename: '测试图片.png',
        mimeType: 'image/png',
        mimetype: 'image/png',
        sizeBytes: 68,
        availability: 'available',
      };
      const rows =
        input.type === 'images'
          ? [image]
          : input.type === 'documents'
            ? [{ ...file, mimetype: 'text/plain', sizeBytes: 120, availability: 'available' }]
            : [
                { ...file, mimetype: 'text/plain', sizeBytes: 120, availability: 'available' },
                image,
              ];
      return {
        items: rows.filter((x) => !input.q || x.filename.includes(input.q)),
        nextCursor: null,
      };
    }
    case 'files.availability':
      return { items: [{ ...file, available: true }] };
    case 'files.delete':
      return { ok: true };
    case 'roles.list':
      return {
        plan: profile.plan,
        catalogue: [
          {
            id: 'content-creator',
            nameZh: '内容创作',
            nameEn: 'Content',
            descriptionZh: '本地测试角色',
            descriptionEn: 'Local seed',
            tier: 'open',
            category: 'marketing',
          },
          {
            id: 'product-manager',
            nameZh: '产品经理',
            nameEn: 'Product',
            descriptionZh: '专业角色',
            descriptionEn: 'Local seed',
            tier: 'pro',
            category: 'product',
          },
        ],
        selected: [],
        pickLimit: 5,
        changesThisMonth: 0,
        changesLimit: 3,
      };
    case 'roles.select':
      return {
        selected: input.roleIds ?? input.selected ?? [],
        changesThisMonth: 1,
        changesLimit: 3,
      };
    case 'skills.list':
      return [
        {
          id: 'data-report-insight',
          name: '数据报告解读',
          logoId: 'data-report-insight',
          category: '分析决策',
          description: '分析本地测试报表',
          aliases: ['数据'],
          maturity: 'template',
          connectors: [],
          experience: {
            starterPrompts: ['分析这份数据报告'],
            requiredInputs: ['数据报告'],
            deliverables: ['分析结论'],
            boundary: '只处理本地测试数据',
            exampleSummary: '测试报告结果',
          },
          enabled: true,
        },
      ];
    case 'skills.toggle':
      return { enabled: input.enabled };
    case 'connections.list':
      return [
        {
          id: 'github',
          name: 'GitHub',
          icon: 'Github',
          description: '测试连接器申请',
          category: 'development',
          oauthSupported: false,
          comingSoon: true,
        },
      ];
    case 'apiKeys.list':
      return s.apiKeys;
    case 'apiKeys.create': {
      const row = {
        apiKeyId: 'key_ui',
        name: input.name,
        keyPrefix: 'SYNTHETIC',
        createdAt: at,
        revokedAt: null,
      };
      s.apiKeys.push(row);
      return { ...row, plaintext: 'SYNTHETIC-NOT-A-REAL-KEY' };
    }
    case 'apiKeys.revoke':
      s.apiKeys = s.apiKeys.filter((x) => x.apiKeyId !== input.apiKeyId);
      return { ok: true };
    case 'models.list':
      return {
        items: [
          {
            id: 'qwen',
            label: '千问',
            provider: 'local',
            isDefault: true,
            adminOnly: false,
            configured: true,
          },
          {
            id: 'second',
            label: '测试第二模型',
            provider: 'local',
            isDefault: false,
            adminOnly: false,
            configured: true,
          },
        ],
        brains: [{ id: 'sonnet', name: '测试模型', label: '测试模型', available: true }],
        image: [],
        video: [],
      };
    case 'models.adminList':
      return {
        lanes: [
          'suggestions',
          'plan',
          'generate',
          'scrape',
          'video_edit_planner',
          'verifier',
          'browser',
          'vision',
        ],
        items: [
          {
            id: 'qwen',
            label: '千问',
            provider: 'alibaba-model-studio',
            enabled: true,
            isDefault: true,
            adminOnly: false,
            configured: true,
            sortOrder: 1,
            laneModels: { generate: 'qwen-test', browser: 'qwen-test' },
            updatedAt: at,
          },
        ],
      };
    case 'models.adminUpdate':
      return dispatch(s, 'models.adminList');
    case 'models.adminMcpList':
      return { items: [] };
    case 'videoEditing.capability':
      return { enabled: false, reason: 'Local audit seed has no media renderer' };
    case 'quota.status':
      return {
        plan: 'pro',
        period: 'day',
        tasksUsed: 2,
        tasksLimit: 100,
        tasksRemaining: 98,
        bonusTasks: 0,
        opusUsed: 0,
        opusLimit: 10,
        opusRemaining: 10,
        bonusOpus: 0,
        concurrentCount: 1,
        concurrencyLimit: 5,
      };
    case 'usage.summary':
      return {
        plan: 'pro',
        period: { start: at, end: '2026-11-09T10:00:00Z' },
        used: 2,
        limit: 100,
        tasks: [],
        daily: [],
        byDay: [],
        byType: [],
        quota: { used: 2, limit: 100 },
        credits: { remaining: 1000 },
      };
    case 'payment.options':
    case 'payment.cnOptions':
      return { enabled: false, plans: [], methods: [] };
    case 'admin.dashboard':
      return {
        metrics: {
          todayTasks: { value: 20, prev: 18 },
          successRate: { value: 90, prev: 89 },
          activeUsers: { value: 1, prev: 1 },
          totalUsers: { value: 1, prev: 1 },
        },
        trend: [],
        recent: [],
      };
    case 'admin.userList':
      return { users: [profile], total: 1, nextCursor: null };
    case 'admin.userDetail':
      return { user: profile, tasks: s.tasks, usage: [], sessions: [] };
    case 'selfCheck.latest':
      return null;
    case 'selfCheck.run':
      return { ok: true, checks: [] };
    case 'watchlists.list':
      return s.watchlist;
    case 'watchlists.add': {
      const already = s.watchlist.some((x) => x.symbol === input.symbol);
      if (!already)
        s.watchlist.push({ ...input, name: input.displayName ?? input.symbol, createdAt: at });
      return { ok: true, already };
    }
    case 'watchlists.remove':
      s.watchlist = s.watchlist.filter((x) => x.symbol !== input.symbol);
      return { ok: true };
    case 'watchlists.update':
      s.watchlist = s.watchlist.map((x) => (x.symbol === input.symbol ? { ...x, ...input } : x));
      return { ok: true };
    case 'watchlists.enableDailyBriefing':
      s.briefingEnabled = true;
      return { enabled: true };
    case 'watchlists.disableDailyBriefing':
      s.briefingEnabled = false;
      return { enabled: false };
    case 'watchlists.briefingStatus':
      return { enabled: s.briefingEnabled, lastRunAt: null, nextRunAt: null };
    case 'stocks.riskRadar':
      return {
        signals: [],
        checks: [],
        dataAsOf: at,
        requestedStockCount: 1,
        checkedStockCount: 1,
        truncated: false,
      };
    case 'stocks.preferenceProfile':
    case 'stocks.updatePreferenceProfile':
    case 'stocks.clearPreferenceProfile':
      return {
        state: 'empty',
        enabled: true,
        confidence: { level: 'insufficient', label: '样本不足', score: 0, basis: '本地合成数据' },
        window: { days: 90, from: '2026-07-11', to: '2026-10-09' },
        sample: { screeningRuns: 0, watchlistStocks: 1, manualDimensions: 0 },
        facts: [],
        possibleStrengths: [],
        blindSpots: [],
        supplementaryViews: [],
        basis: [],
        manualPreferences: {
          industries: [],
          marketCaps: [],
          valuation: [],
          profitability: [],
          growth: [],
          cashFlow: [],
          volatility: [],
          liquidity: [],
          events: [],
          holdingPeriods: [],
        },
      };
    case 'stocks.newsDetail':
      return {
        url: input.url,
        contentStatus: 'source-body',
        sourceName: '本地新闻种子',
        publishedAt: at,
        summary: '本地测试新闻摘要',
        body: ['仅用于本地界面回归测试的新闻正文。'],
        extractedAt: at,
      };
    case 'stocks.previewScreening':
      return { criteria: [], unparsedClauses: [input.prompt ?? 'UI audit'] };
    case 'stocks.searchSymbols':
      return [{ symbol: '600519', name: '贵州茅台', exchange: 'SH' }];
    case 'stocks.discoveryFeed':
      return { items: [], page: input.page ?? 1, hasMore: false };
    case 'stocks.dashboardSnapshot':
      return {
        snapshotId: 'stkshot_0123456789abcdef01234567',
        asOf: at,
        dataAsOf: at,
        marketStatus: 'closed',
        generatedAt: at,
        watchlistStocks: [
          {
            symbol: '600519',
            name: '贵州茅台',
            market: 'A',
            price: '1272.08',
            changePct: 1.2,
            signal: '偏强',
            report: '待生成',
            spark: [1260, 1272],
            newsCount: 1,
            note: '本地种子数据',
          },
        ],
        marketIndices: [
          { name: '上证指数', price: '3300.00', changePct: 0.5, turnover: '100亿元' },
        ],
        sectors: [],
        news: [
          {
            title: '本地市场测试新闻',
            time: '10:00',
            symbols: ['600519'],
            source: '东方财富',
            url: 'https://example.com/news',
            category: '新闻',
          },
        ],
        leaders: [],
        temperature: null,
        trust: {
          mode: 'current',
          generatedAt: at,
          dataAsOf: '2026-10-09',
          latestExpectedTradingDate: '2026-10-09',
          marketTimezone: 'Asia/Shanghai',
          marketSession: 'non-trading',
          calendarStatus: 'verified',
          sources: [],
          snapshotId: 'stkshot_0123456789abcdef01234567',
          evidenceIds: [],
        },
        indices: [],
        highlights: [],
        watchlist: [],
        discovery: [],
        market: { status: 'closed' },
        freshness: { status: 'current', asOf: at },
        degraded: false,
      };
    case 'stocks.generateBriefingNow':
      return { taskId: 'tsk_ui_scrape_completed' };
    case 'scheduledTasks.list':
      return s.scheduled;
    case 'scheduledTasks.create': {
      const scheduledTaskId = `sch_ui_${s.scheduled.length}`;
      s.scheduled.push({
        ...input,
        scheduledTaskId,
        status: 'active',
        nextRunAt: input.scheduledAt,
        createdAt: at,
        updatedAt: at,
      });
      return {
        scheduledTaskId,
        nextRunAt: input.scheduledAt,
        requestedRunAt: input.scheduledAt,
        adjusted: false,
      };
    }
    case 'scheduledTasks.runNow': {
      const row = s.scheduled.find((x) => x.scheduledTaskId === input.scheduledTaskId);
      if (!row) throw new Error('scheduled task not found');
      row.status = 'active';
      row.nextRunAt = at;
      return { ok: true, nextRunAt: at };
    }
    case 'scheduledTasks.delete':
      s.scheduled = s.scheduled.filter((x) => x.scheduledTaskId !== input.scheduledTaskId);
      return { ok: true };
    case 'scheduledTasks.toggle':
    case 'scheduledTasks.update': {
      const row = s.scheduled.find((x) => x.scheduledTaskId === input.scheduledTaskId);
      if (row) Object.assign(row, input);
      return row ?? { ok: true };
    }

    case 'batchTasks.list':
      return { batches: [], nextCursor: null };
    case 'batchTasks.detail':
      return {
        batchId: 'bat_ui',
        title: '测试批量任务',
        status: 'completed',
        tasks: [],
        items: [],
        createdAt: at,
      };
    case 'memory.list':
    case 'memory.listMemories':
      return { memories: s.memories };
    case 'memory.delete':
      s.memories = s.memories.filter((x) => x.externalId !== input.externalId);
      return { ok: true };
    case 'memory.clear':
      s.memories = [];
      return { ok: true };
    case 'feedback.submit':
      return { ok: true, feedbackId: 'feedback_ui' };
    case 'browserReplay.remove':
      return { ok: true };
    case 'files.saveOutput':
      return { ...file, fileId: 'fil_saved_ui' };
    case 'organizations.list':
      return s.organizations;
    case 'organizations.create': {
      const row = {
        organizationId: `org_local_${s.organizations.length}`,
        name: input.name,
        role: 'owner',
        managerDisplayName: null,
        activeMemberCount: 1,
      };
      s.organizations.push(row);
      return row;
    }
    case 'organizations.members':
      return s.members.filter((x) => x.organizationId === input.organizationId);
    case 'organizations.deactivateMember':
      s.members = s.members.filter((x) => x.memberId !== input.memberId);
      return { ok: true };
    case 'organizations.updateMemberRole':
    case 'organizations.updateReportingLine': {
      const row = s.members.find((x) => x.memberId === input.memberId);
      if (row) Object.assign(row, input);
      return row ?? { ok: true };
    }
    case 'organizations.createInvitation':
      return {
        organizationId: input.organizationId,
        invitationId: 'inv_ui',
        inviteUrl: 'http://127.0.0.1/organizations/invitations/accept#token=ui-local-invitation',
        expiresAt: '2026-10-16T10:00:00.000Z',
      };
    case 'organizations.acceptInvitation':
      return { status: 'accepted' };
    case 'accountClosure.preview':
      return {
        graceEndsAt: '2026-10-16T00:00:00.000Z',
        plan: { name: 'pro', expiresAt: '2026-12-31T00:00:00.000Z' },
        counts: {
          activeTasks: 2,
          futureTasks: 3,
          files: 4,
          stockItems: 5,
          notificationChannels: 1,
        },
        retainedCategoryIds: ['payments_entitlements', 'partner_kyc_ledger'],
        automaticRefund: false,
      };
    case 'accountClosure.requestCancellationVerification':
    case 'accountClosure.requestVerification':
      return {
        challengeId: 'ach_ui',
        channel: 'email',
        maskedDestination: 'u***@example.test',
        expiresAt: '2026-10-09T01:10:00.000Z',
      };
    case 'accountClosure.begin':
      return {
        recoveryToken: 'local-recovery-only',
        requestStatus: 'pending_grace',
        graceEndsAt: '2026-10-16T00:00:00.000Z',
        receipt: { receiptNumber: 'ACR-LOCAL-UI' },
      };
    case 'accountClosure.status':
      return {
        requestStatus: 'pending_grace',
        requestedAt: at,
        graceEndsAt: '2026-10-16T10:00:00.000Z',
        completedAt: null,
        cancelledAt: null,
        canCancel: true,
        plan: { name: 'pro', expiresAt: '2026-12-31T00:00:00.000Z' },
        mfaRequired: false,
      };
    case 'accountClosure.applicationReceipt':
      return {
        receiptNumber: 'ACR-LOCAL-UI',
        kind: 'application',
        issuedAt: at,
        completedCategoryIds: [],
        restrictedCategoryIds: ['payments_entitlements', 'partner_kyc_ledger'],
      };
    case 'accountClosure.cancel':
      return { cancelled: true };
    case 'taskRecovery.failureContext':
      return {
        taskId: input.taskId,
        refund: { state: 'refunded', refundedAt: at },
        inputFiles: [],
        unavailableInputCount: 0,
      };

    case 'notificationChannels.list':
      return [];
    case 'payment.ledger':
      return { items: [], nextCursor: null };
    case 'admin.finance.summary':
      return {
        monthRevenueCnyCents: 10000,
        monthCostCnyCents: 2000,
        monthLlmCostCnyCents: 1000,
        monthServerCostCnyCents: 1000,
        monthProfitCnyCents: 8000,
        unknownCostCalls: 0,
      };
    case 'admin.finance.revenueByPlan':
      return {
        plans: [{ kind: 'subscription', plan: 'pro', userCount: 1, monthRevenueCnyCents: 10000 }],
      };
    case 'admin.finance.revenueByMonth':
      return { series: [{ month: '2026-10', revenueCnyCents: 10000 }] };
    case 'admin.finance.conversionFunnel':
      return {
        stages: [
          { label: '注册', count: 10 },
          { label: '付费', count: 1 },
        ],
        ltvCnyCents: 10000,
      };
    case 'admin.finance.costBreakdown':
      return {
        models: [
          {
            model: 'qwen-test',
            provider: 'local',
            costCnyCents: 1000,
            knownCostCnyCents: 1000,
            unknownCostCalls: 0,
            callCount: 10,
            totalTokens: 10000,
            incompleteUsageCalls: 0,
          },
        ],
      };
    case 'admin.finance.costByDay':
      return { series: [{ date: '2026-10-09', costCnyCents: 1000, unknownCostCalls: 0 }] };
    case 'admin.finance.topCostlyTasks':
      return {
        tasks: [
          {
            taskId: s.tasks[1].taskId,
            title: s.tasks[1].title,
            costCnyCents: 1000,
            callCount: 10,
            totalTokens: 10000,
          },
        ],
      };
    case 'admin.finance.taskCost':
      return {
        taskId: input.taskId,
        costCnyCents: 1000,
        knownCostCnyCents: 1000,
        callCount: 10,
        unknownCostCalls: 0,
      };
    case 'admin.learning.overview':
      return {
        metrics: { analyzedDomainsCount: 1, highRiskCount: 0, aiMemoriesCount: 1 },
        coverage: { scannedTasks: 20, truncated: false },
        total: 1,
        domains: [
          {
            domain: 'browser',
            total: 20,
            success: 16,
            failed: 4,
            cancelled: 0,
            successRate: 80,
            lastFailedAt: at,
            topFailureLabel: '测试超时',
          },
        ],
      };
    case 'admin.learning.domainDetail':
      return {
        domain: input.domain,
        stats: {
          total: 20,
          successRate: 80,
          cancelled: 0,
          failed: 4,
          firstTaskAt: at,
          lastTaskAt: at,
        },
        failureBreakdown: [
          { category: 'timeout', label: '超时', count: 4, share: 100, lastAt: at },
        ],
        recentTasks: s.tasks.slice(0, 3),
        memories: [
          { externalId: 'mem_ui', keyName: '测试页面', value: '本地测试记忆', updatedAt: at },
        ],
      };
    case 'admin.learning.evolution':
      return {
        paths: { total: 1, verified: 1, draft: 0, stale: 0 },
        canary: { runs: 1, passRate: 100 },
        reuse: { attempts: 1, hits: 1, repaired: 0, hitRate: 100 },
        modelCallsSaved: 1,
        windowDays: 30,
      };
    case 'admin.partner.overview':
    case 'admin.partner.reconciliation':
    case 'partner.dashboard':
      return {
        enabled: false,
        reason: 'Feature remains disabled in the local default configuration',
      };
    case 'energy.home':
      return { experiences: [] };
    case 'energy.reportEvent':
      return { ok: true };
    case 'astrology.ranking':
      return { complete: false, items: [] };
    case 'astrology.status':
      return { provider: 'local', capabilities: [] };
    case 'astrology.daily':
    case 'astrology.weekly':
    case 'astrology.monthly':
    case 'astrology.yearly':
      return {
        period: name.split('.')[1],
        provider: 'local',
        source: 'local-fallback',
        freshness: 'current',
        zodiacSign: input.zodiacSign ?? 'aries',
        zodiacLabel: '白羊座',
        rangeLabel: '本地测试',
        rangeKey: 'today',
        summary: '今天适合从一个小目标开始。',
        dimensions: [],
        luckyColors: ['蓝色'],
        luckyNumbers: [3],
        luckyLetters: ['A'],
        suitableTimes: ['上午'],
        sevenDayTrend: [],
        cosmicTip: '测试内容仅用于界面验收',
        singlesTip: '保持交流',
        couplesTip: '一起散步',
      };
    case 'plannedTasks.list':
      return [plan];
    case 'plannedTasks.detail':
      return { ...plan };
    case 'plannedTasks.calendar':
      return [
        {
          occurrenceId: 'occ_ui',
          plannedTaskId: plan.plannedTaskId,
          title: plan.title,
          scheduledFor: at,
          originalScheduledFor: at,
          changed: false,
          status: 'active',
          repeatType: 'daily',
          itemCount: 1,
          timezone: 'Asia/Shanghai',
        },
      ];
    case 'plannedTasks.runs':
      return [];
    case 'plannedTasks.reportLoadMetric':
      return { ok: true };
    case 'plannedTasks.create':
    case 'plannedTasks.update':
      return { ...plan, ...input };
    case 'plannedTasks.toggle':
    case 'plannedTasks.archive':
    case 'plannedTasks.delete':
    case 'plannedTasks.runNow':
    case 'plannedTasks.removeOccurrence':
    case 'plannedTasks.rescheduleOccurrence':
      return { ok: true };
    case 'projects.members':
      return [
        {
          userId: 'usr_ui',
          displayName: profile.displayName,
          email: profile.email,
          role: 'lead',
          projectMemberId: 'pm_ui',
          organizationMemberId: 'om_ui',
        },
      ];
    case 'teamTasks.list':
      return [];
    case 'teamTasks.planningOptions':
      return { milestones: [], members: [] };
    case 'videoOnboarding.status':
      return { hasVoice: false, hasBaseVideo: false, authorized: false, baseVideoIssue: null };
    case 'videoEditing.getProject':
      throw new ExpectedSeedError(403, 'FORBIDDEN', '继续剪辑暂未开放');
    case 'browserReplay.read':
      return { frames: [], events: [] };
  }
  s.unhandled.push({ name, method });
  throw Error(`UNHANDLED_SEED_RPC: ${name}`);
}

export class ExpectedSeedError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
