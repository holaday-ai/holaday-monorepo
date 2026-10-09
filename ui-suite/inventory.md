# UI inventory

Generated from App.tsx and every non-test TSX component. Static candidates are not runtime pass claims. Runtime report links each discovered control to its observed outcome; missing outcomes remain coverage gaps.

## Pages

| Route | Component | Source | Static controls |
| --- | --- | --- | --- |
| /account/closure-recovery | AccountClosureRecoveryPage | src/pages/AccountClosureRecoveryPage.tsx | 24 |
| /login | Unknown | redirect / composed route | 0 |
| /register | Unknown | redirect / composed route | 0 |
| /privacy | PrivacyPage | src/pages/PrivacyPage.tsx | 4 |
| /terms | TermsPage | src/pages/TermsPage.tsx | 1 |
| /500 | ServerErrorPage | src/pages/ServerErrorPage.tsx | 3 |
| /cosmic-preview | AstrologyPage | src/pages/AstrologyPage.tsx | 163 |
| /app | AppAliasRedirect | redirect / composed route | 115 |
| /roles | LegacyRolesRedirect | redirect / composed route | 115 |
| /tasks | LegacyPathRedirect | redirect / composed route | 115 |
| /schedule | LegacyPathRedirect | redirect / composed route | 115 |
| /calendar | LegacyPathRedirect | redirect / composed route | 115 |
| /experts | LegacyPathRedirect | redirect / composed route | 115 |
| /plugins | LegacyPathRedirect | redirect / composed route | 115 |
| /settings/appearance | LegacySettingsSectionRedirect | redirect / composed route | 115 |
| /settings/api-keys | LegacySettingsSectionRedirect | redirect / composed route | 115 |
| /settings/memory | LegacySettingsSectionRedirect | redirect / composed route | 115 |
| /settings/notifications | LegacySettingsSectionRedirect | redirect / composed route | 115 |
| /settings/account | LegacySettingsSectionRedirect | redirect / composed route | 115 |
| /admin | AdminDashboardPage | src/pages/admin/AdminDashboardPage.tsx | 115 |
| /admin/users | AdminUsersPage | src/pages/admin/AdminUsersPage.tsx | 122 |
| /admin/users/:userId | AdminUserDetailPage | src/pages/admin/AdminUserDetailPage.tsx | 115 |
| /admin/finance | AdminFinancePage | src/pages/admin/AdminFinancePage.tsx | 120 |
| /admin/partners | AdminPartnerReviewPage | src/pages/admin/AdminPartnerReviewPage.tsx | 147 |
| /admin/learning | AdminLearningPage | src/pages/admin/AdminLearningPage.tsx | 122 |
| /admin/models | AdminModelsPage | src/pages/admin/AdminModelsPage.tsx | 124 |
| /admin/self-check | AdminSelfCheckPage | src/pages/admin/AdminSelfCheckPage.tsx | 117 |
| /admin/learning/:domain | AdminLearningDomainPage | src/pages/admin/AdminLearningDomainPage.tsx | 116 |
| / | WorkbenchApp | src/WorkbenchApp.tsx | 263 |
| /profile | ProfilePage | src/pages/ProfilePage.tsx | 140 |
| /settings | SettingsPage | src/pages/SettingsPage.tsx | 172 |
| /settings/roles | RolesPage | src/pages/RolesPage.tsx | 123 |
| /partner | PartnerPage | src/pages/PartnerPage.tsx | 139 |
| /partner/recharge | PartnerWorkbenchSectionRedirect | redirect / composed route | 115 |
| /partner/ledger | PartnerWorkbenchSectionRedirect | redirect / composed route | 115 |
| /partner/withdraw | PartnerWorkbenchSectionRedirect | redirect / composed route | 115 |
| /plan | PlanPage | src/pages/PlanPage.tsx | 132 |
| /billing | BillingPage | src/pages/BillingPage.tsx | 130 |
| /usage | UsagePage | src/pages/UsagePage.tsx | 123 |
| /cosmic | AstrologyPage | src/pages/AstrologyPage.tsx | 163 |
| /history | HistoryPage | src/pages/HistoryPage.tsx | 125 |
| /skills | SkillsPage | src/pages/SkillsPage.tsx | 152 |
| /stocks | StockTasksPage | src/pages/StockTasksPage.tsx | 218 |
| /stocks/discovery | StockDiscoveryPage | src/pages/StockDiscoveryPage.tsx | 126 |
| /projects | ProjectsPage | src/pages/ProjectsPage.tsx | 164 |
| /projects/:projectId | TeamProjectPage | src/pages/TeamProjectPage.tsx | 179 |
| /organizations/invitations/accept | OrganizationInvitationAcceptPage | src/pages/OrganizationInvitationAcceptPage.tsx | 116 |
| /starred | StarredPage | src/pages/StarredPage.tsx | 122 |
| /files | FilesPage | src/pages/FilesPage.tsx | 148 |
| /video | VideoGate | redirect / composed route | 115 |
| /video/edit/:projectId | VideoEditingRoute | redirect / composed route | 115 |
| /image | ImagePage | src/pages/ImagePage.tsx | 165 |
| /planned | PlannedTasksPage | src/pages/planned/PlannedTasksPage.tsx | 161 |
| /planned/legacy-scheduled | ScheduledPage | src/pages/ScheduledPage.tsx | 132 |
| /planned/legacy-batch | BatchPage | src/pages/BatchPage.tsx | 142 |
| /scheduled | LegacyPathRedirect | redirect / composed route | 115 |
| /batch | LegacyPathRedirect | redirect / composed route | 115 |
| /batch/:batchId | BatchPage | src/pages/BatchPage.tsx | 142 |
| /connections | ConnectionsPage | src/pages/ConnectionsPage.tsx | 122 |
| * | NotFoundPage | src/pages/NotFoundPage.tsx | 117 |

## Manual scenario requirements

All routes run in a local admin seed at three widths; public auth/legal routes use a logged-out seed. Each task mode uses executing, completed, failed, awaiting-user and cancelled records. Shared sidebar, notifications, avatar menus, project menus, task actions, forms, uploads, tabs and nested dialogs are traversed from their visible entry points. Runtime outcomes and action paths are in report.json.

Default-off partner payments, browser-data grants and video rendering remain off. Real identity, payment, external site health and licensed media rendering are not proven by this suite. Disabled controls and deeper unreachable states are recorded, never counted as action passes.

## Human-reviewed interaction map

This supplements the generated source candidates. Each family also includes the shared sidebar, notification bell, account menu, locale/theme controls and navigation links. `report.json` records actual controls, disabled prerequisites and gaps at each width; this table defines the expected behavior rather than claiming that every conditional branch was reached.

| Pages / states | Interactive components | Expected local behavior / assertions |
| --- | --- | --- |
| `/login`, `/register`, `/account/closure-recovery` | Password/email-code/phone tabs, password reveal, email/phone/code inputs, send/resend, register/login/reset links, recovery actions | Selected method changes fields; reveal changes input type; valid local request changes state. No real code is sent. Active method is idempotent and should expose selected semantics. Multi-field submission prerequisites are recorded. |
| `/`, `/app`, `/tasks`, five states of generate/browser/scrape/image | Composer, uploads, role/model/Chrome pickers, task selector, stop/retry/reply, task menu, result/source links, browser workspace and recent steps | Each control changes state or sends its own request. Load-more adds task identities. Non-browser results contain no browser workspace. Terminal tasks contain no processing status. Popups reach their requested URL through a local response. |
| `/history`, `/starred` | Filters/search, task links, task menus, rename/star/delete, load-more | Filter changes list or request; item operations mutate local state; pagination adds rows rather than only changing its label. |
| `/stocks`, `/stocks/discovery` | Watchlist rows, add/remove/search, briefing controls, period/type dropdowns, news links and composer | Menus dismiss, controls remain clickable and unoccluded at each width; row identity/data changes; source URL opens. Data date and stale state remain visible. |
| `/cosmic`, `/cosmic-preview` | Energy cards, six-item expansion, profile/birthday/zodiac, daily/weekly/monthly/yearly, mini-game actions, reset/replay/continue | Inline regions collapse; game state changes and completion can be reached; local storage is reset between replay paths; unavailable API features remain explicit. No personalized prediction accuracy is certified. |
| `/profile`, `/settings`, legacy settings aliases | Section navigation, display name, theme, region, password/code, MFA, memory, notifications, browser-data consent, account closure dialogs | Current panel changes; local requests match actual contract. Dialog cancel/close dismisses. Sensitive/disabled prerequisites are explicit. No real secret or account is used. |
| `/settings/roles`, `/roles`, `/experts`, `/skills`, `/plugins`, `/connections` | Role/skill selectors, enable switches, details, connector authorization/apply buttons | Selection/toggle/detail state changes; unsupported integrations show their actual disabled state. No external OAuth is performed. |
| `/plan`, `/billing`, `/usage`, `/partner` and aliases | Plan period/tier buttons, billing sections, ledger filters, usage selectors, partner controls | Local options render; purchase/provider operations remain default-off and never contact providers. Empty/default-off states are recorded distinctly from enabled workflow success. |
| `/projects`, `/projects/:projectId`, invitation accept | Project create/edit/search, project/member menus, task/files panels, member selectors, invitation accept | Dialog/panel changes, local row mutations and permission labels. A fixture does not certify real tenant isolation. |
| `/files` | Search/filter, upload, row open/download/share/delete, pagination | In-memory upload only; filename renders, local download resolves, rows change after mutation. No host file is uploaded. |
| `/planned`, legacy schedule/calendar/batch routes and `/batch/:batchId` | List/calendar tabs, date navigation, create/edit, repeat selectors, run/pause/archive/delete, event menus | Dates/lists/dialogs change; local operations update the fixture; new pagination rows must have distinct identities. |
| `/image`, `/video`, `/video/edit/:projectId` | Prompt, model/aspect selectors, upload, generate/authorize/setup, editor entry | Inputs and local state are checked. Licensed video SDK remains off; only the exact getProject FORBIDDEN contract is expected. Media generation/paid export is not certified. |
| `/admin`, users/detail, finance, partners, learning/domain, models, self-check | Tables, search/filter/pagination, detail links, model toggles/forms, run self-check | Seed rows render and local state/requests change; no administration of real users/models/services. |
| `/privacy`, `/terms`, `/500`, `*` | Navigation, help links, retry/back | Route changes or same-document reload request is observed; external mail/tel URI handoff is validated without launching host applications. |

Dialog/menu scope and action paths are retained, including failed outcomes. Geometry checks are run on the initial page and successful interaction states. Hidden/transparent native inputs, intentional dialog layers and horizontal scrollers are excluded only by explicit measured rules. First screenshots establish a baseline; they are not visual comparison passes.


## Page × interactive component × expected behavior

### /account/closure-recovery

- src/components/settings/AccountClosureSection.tsx:135 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/settings/AccountClosureSection.tsx:178 — 关闭账号向导 — visible state, dialog, route or recorded local request
- src/components/settings/AccountClosureSection.tsx:193 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/settings/AccountClosureSection.tsx:212 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/settings/AccountClosureSection.tsx:228 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/settings/AccountClosureSection.tsx:232 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/settings/AccountClosureSection.tsx:236 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/settings/AccountClosureSection.tsx:322 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/settings/AccountClosureSection.tsx:362 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/settings/AccountClosureSection.tsx:368 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/settings/AccountClosureSection.tsx:380 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/AccountClosureRecoveryPage.tsx:102 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/AccountClosureRecoveryPage.tsx:135 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/AccountClosureRecoveryPage.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/AccountClosureRecoveryPage.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/AccountClosureRecoveryPage.tsx:203 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/AccountClosureRecoveryPage.tsx:223 — [dynamic label] — route or new target URL
- src/pages/AccountClosureRecoveryPage.tsx:328 — 关闭撤回验证 — visible state, dialog, route or recorded local request
- src/pages/AccountClosureRecoveryPage.tsx:347 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/AccountClosureRecoveryPage.tsx:356 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/AccountClosureRecoveryPage.tsx:363 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/AccountClosureRecoveryPage.tsx:377 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/AccountClosureRecoveryPage.tsx:380 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/AccountClosureRecoveryPage.tsx:461 — [dynamic label] — value/state changes; submit persists to local seed

### /login

Redirect / dynamic composition: runtime inventory required.

### /register

Redirect / dynamic composition: runtime inventory required.

### /privacy

- src/pages/PrivacyPage.tsx:298 — [dynamic label] — route or new target URL
- src/pages/PrivacyPage.tsx:480 — [dynamic label] — route or new target URL
- src/pages/PrivacyPage.tsx:521 — [dynamic label] — route or new target URL
- src/pages/PrivacyPage.tsx:530 — [dynamic label] — route or new target URL

### /terms

- src/pages/TermsPage.tsx:101 — support@holaday.ai — route or new target URL

### /500

- src/pages/ServerErrorPage.tsx:17 — window.location.reload()}>重试 — visible state, dialog, route or recorded local request
- src/pages/ServerErrorPage.tsx:19 — 返回首页 — visible state, dialog, route or recorded local request
- src/pages/ServerErrorPage.tsx:24 — [dynamic label] — route or new target URL

### /cosmic-preview

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/AstrologyDimensionGrid.tsx:73 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/AstrologyDimensionGrid.tsx:95 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/AstrologyPortalRow.tsx:53 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/AstrologyWorld.tsx:113 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/AstrologyWorld.tsx:131 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/AstrologyWorld.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/AstrologyWorld.tsx:162 — 刷新当前星座范围 — visible state, dialog, route or recorded local request
- src/components/energy/AstrologyWorld.tsx:256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/AstrologyWorld.tsx:276 — [dynamic label] — route or new target URL
- src/components/energy/EnergyAstrologyPanel.tsx:24 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyAstrologyPanel.tsx:28 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyAstrologyPanel.tsx:36 — 刷新星座能量 — visible state, dialog, route or recorded local request
- src/components/energy/EnergyContinueCard.tsx:24 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyContinueCard.tsx:32 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyContinueCard.tsx:43 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyExperienceDeck.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyExploreFeed.tsx:184 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyExploreFeed.tsx:238 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyExploreFeed.tsx:247 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyExploreFeed.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyExploreFeed.tsx:261 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyExploreFeed.tsx:273 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyHero.tsx:90 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyHero.tsx:99 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyHero.tsx:127 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyHero.tsx:150 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyMagazineCard.tsx:81 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyMagazineCard.tsx:101 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyProfileDrawer.tsx:85 — 关闭个人资料 — visible state, dialog, route or recorded local request
- src/components/energy/EnergyProfileDrawer.tsx:104 — 生日 — value/state changes; submit persists to local seed
- src/components/energy/EnergyProfileDrawer.tsx:117 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyProfileDrawer.tsx:131 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/energy/EnergyProfileDrawer.tsx:142 — 例如：Tokyo — value/state changes; submit persists to local seed
- src/components/energy/EnergyProfileDrawer.tsx:157 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyProfileDrawer.tsx:164 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyProfileDrawer.tsx:180 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyProfileDrawer.tsx:183 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergySectionNav.tsx:56 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyShelf.tsx:42 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyShelf.tsx:56 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyShelf.tsx:151 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyShelf.tsx:172 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyShelf.tsx:207 — [dynamic label] — route or new target URL
- src/components/energy/ExperiencePlayer.tsx:100 — 关闭体验 — visible state, dialog, route or recorded local request
- src/components/energy/ExperiencePlayer.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/ExperiencePlayer.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/ExperiencePlayer.tsx:141 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/RunningTaskDock.tsx:86 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request

### /app

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request

### /roles

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request

### /tasks

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request

### /schedule

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request

### /calendar

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request

### /experts

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request

### /plugins

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request

### /settings/appearance

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request

### /settings/api-keys

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request

### /settings/memory

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request

### /settings/notifications

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request

### /settings/account

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request

### /admin

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request

### /admin/users

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/admin/AdminUsersPage.tsx:121 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminUsersPage.tsx:131 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminUsersPage.tsx:137 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminUsersPage.tsx:143 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminUsersPage.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminUsersPage.tsx:262 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminUsersPage.tsx:310 — [dynamic label] — visible state, dialog, route or recorded local request

### /admin/users/:userId

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request

### /admin/finance

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/admin/AdminFinancePage.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminFinancePage.tsx:145 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminFinancePage.tsx:236 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminFinancePage.tsx:843 — 成本查询任务 ID — value/state changes; submit persists to local seed
- src/pages/admin/AdminFinancePage.tsx:844 — [dynamic label] — visible state, dialog, route or recorded local request

### /admin/partners

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/admin/AdminPartnerReviewPage.tsx:276 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminPartnerReviewPage.tsx:484 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminPartnerReviewPage.tsx:533 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminPartnerReviewPage.tsx:617 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminPartnerReviewPage.tsx:624 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminPartnerReviewPage.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminPartnerReviewPage.tsx:632 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminPartnerReviewPage.tsx:761 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminPartnerReviewPage.tsx:767 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminPartnerReviewPage.tsx:777 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminPartnerReviewPage.tsx:783 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminPartnerReviewPage.tsx:789 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminPartnerReviewPage.tsx:795 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminPartnerReviewPage.tsx:801 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminPartnerReviewPage.tsx:842 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminPartnerReviewPage.tsx:867 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminPartnerReviewPage.tsx:947 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminPartnerReviewPage.tsx:960 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminPartnerReviewPage.tsx:972 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminPartnerReviewPage.tsx:1062 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminPartnerReviewPage.tsx:1088 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminPartnerReviewPage.tsx:1099 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminPartnerReviewPage.tsx:1127 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminPartnerReviewPage.tsx:1138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminPartnerReviewPage.tsx:1221 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminPartnerReviewPage.tsx:1232 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminPartnerReviewPage.tsx:1341 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminPartnerReviewPage.tsx:1352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminPartnerReviewPage.tsx:1390 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminPartnerReviewPage.tsx:1405 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminPartnerReviewPage.tsx:1416 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminPartnerReviewPage.tsx:1630 — [dynamic label] — visible state, dialog, route or recorded local request

### /admin/learning

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/admin/AdminLearningPage.tsx:138 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminLearningPage.tsx:146 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminLearningPage.tsx:149 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminLearningPage.tsx:155 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminLearningPage.tsx:211 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminLearningPage.tsx:224 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminLearningPage.tsx:382 — [dynamic label] — visible state, dialog, route or recorded local request

### /admin/models

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/admin/AdminModelsPage.tsx:141 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminModelsPage.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminModelsPage.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminModelsPage.tsx:207 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminModelsPage.tsx:219 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminModelsPage.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminModelsPage.tsx:337 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminModelsPage.tsx:343 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminModelsPage.tsx:349 — [dynamic label] — visible state, dialog, route or recorded local request

### /admin/self-check

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/admin/AdminSelfCheckPage.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminSelfCheckPage.tsx:76 — [dynamic label] — visible state, dialog, route or recorded local request

### /admin/learning/:domain

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/admin/AdminLearningDomainPage.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request

### /

- src/WorkbenchApp.tsx:877 — 收起浏览器 — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/AttachmentChip.tsx:120 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AttachmentChip.tsx:129 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:1345 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:1367 — 收起浏览器 — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:1437 — 退出全屏 (Esc) — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:1495 — 停止当前任务 — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:1513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:1549 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:1745 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:1777 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:1805 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:1860 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:1883 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:1903 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:1914 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:1961 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:2079 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:2097 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:2113 — 全屏查看任务截图 — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:2208 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:2259 — 收起操作日志 — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:2323 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/BrowserPanel.tsx:2415 — 中文 / 任意文本输入（先点击页面上的输入框获得焦点） — value/state changes; submit persists to local seed
- src/components/BrowserPanel.tsx:2434 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:2448 — 关闭浮动输入框 — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:2511 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:2613 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:2666 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:2992 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/BrowserPanel.tsx:3037 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:3082 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:3244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:3261 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserReplay.tsx:46 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserReplay.tsx:55 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserReplay.tsx:65 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserReplay.tsx:99 — 回放时间轴 — value/state changes; submit persists to local seed
- src/components/BrowserReplay.tsx:115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserViewportToolbar.tsx:67 — 适应画面 — visible state, dialog, route or recorded local request
- src/components/BrowserViewportToolbar.tsx:78 — 按原尺寸显示 — visible state, dialog, route or recorded local request
- src/components/BrowserViewportToolbar.tsx:88 — 放大画面 — visible state, dialog, route or recorded local request
- src/components/BrowserViewportToolbar.tsx:107 — 缩小画面 — visible state, dialog, route or recorded local request
- src/components/BrowserViewportToolbar.tsx:119 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserViewportToolbar.tsx:120 — 平移画面 — visible state, dialog, route or recorded local request
- src/components/BrowserViewportToolbar.tsx:140 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserViewportToolbar.tsx:148 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserViewportToolbar.tsx:149 — 网页显示模式 — visible state, dialog, route or recorded local request
- src/components/BrowserViewportToolbar.tsx:168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/CdpScreencastViewport.tsx:53 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/CdpScreencastViewport.tsx:832 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FailureHeaderCard.tsx:85 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FailureHeaderCard.tsx:114 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FileDownloadCard.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FileDownloadCard.tsx:295 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:752 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:766 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:794 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/InputArea.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:838 — 附件与任务选项 — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:857 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:885 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:913 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:958 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:1000 — 添加图片 — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:1002 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:1002 — 选择技能 — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:1004 — applySkillMention(skill)}> — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:1012 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:1012 — 执行模式 — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:1013 — setTaskMode(mode as 'auto' \| 'plan')}> — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:1015 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:1017 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/InputArea.tsx:1018 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/InputArea.tsx:1029 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:1097 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:1272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:1407 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:1416 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LazyLoadBoundary.tsx:113 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LazyLoadBoundary.tsx:135 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LocalChromePicker.tsx:59 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LocalChromePicker.tsx:60 — 选择 Chrome 页面 — visible state, dialog, route or recorded local request
- src/components/LocalChromePicker.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LocalChromePicker.tsx:132 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LocalChromePicker.tsx:147 — 移除 Chrome 页面 — visible state, dialog, route or recorded local request
- src/components/LocalChromeTaskPanel.tsx:23 — 关闭浏览器面板 — visible state, dialog, route or recorded local request
- src/components/LocalChromeTaskPanel.tsx:32 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LocalChromeTaskPanel.tsx:33 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/MainPanel.tsx:178 — 打开任务列表 — visible state, dialog, route or recorded local request
- src/components/MainPanel.tsx:391 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ModelDataRegionDialog.tsx:80 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ModelDataRegionDialog.tsx:111 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ModelDataRegionDialog.tsx:114 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/PlanCard.tsx:87 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/PlanCard.tsx:136 — [dynamic label] — route or new target URL
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/RoleNudgeBanner.tsx:86 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/RoleNudgeBanner.tsx:93 — 关闭角色引导 — visible state, dialog, route or recorded local request
- src/components/ScheduledTaskDialog.tsx:202 — 新建定时任务 — visible state, dialog, route or recorded local request
- src/components/ScheduledTaskDialog.tsx:209 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ScheduledTaskDialog.tsx:224 — 关闭 — visible state, dialog, route or recorded local request
- src/components/ScheduledTaskDialog.tsx:240 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ScheduledTaskDialog.tsx:257 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ScheduledTaskDialog.tsx:276 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ScheduledTaskDialog.tsx:300 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ScheduledTaskDialog.tsx:321 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ScheduledTaskDialog.tsx:339 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ScheduledTaskDialog.tsx:353 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ScheduledTaskDialog.tsx:368 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ScheduledTaskDialog.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ScheduledTaskDialog.tsx:394 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchResultCard.tsx:74 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchResultCard.tsx:122 — [dynamic label] — route or new target URL
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/StepCard.tsx:160 — [dynamic label] — route or new target URL
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/TaskStream.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:853 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:974 — [dynamic label] — route or new target URL
- src/components/TaskStream.tsx:1163 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:1171 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:1179 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:1200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:1210 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:1226 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:1235 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:1244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:1263 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:1628 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:1682 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:1908 — 重新执行任务 — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:2005 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:2147 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:2311 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:2671 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:2684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:2695 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:2726 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:2817 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:2827 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:2828 — 打开更多结果操作 — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:2843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:2850 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:2864 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:2880 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:2913 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:3082 — [dynamic label] — route or new target URL
- src/components/TaskToolbar.tsx:76 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/textarea.tsx:9 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request

### /profile

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/ProfilePage.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProfilePage.tsx:275 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProfilePage.tsx:281 — [dynamic label] — route or new target URL
- src/pages/ProfilePage.tsx:330 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/ProfilePage.tsx:339 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/ProfilePage.tsx:349 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProfilePage.tsx:355 — [dynamic label] — route or new target URL
- src/pages/ProfilePage.tsx:373 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProfilePage.tsx:399 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProfilePage.tsx:444 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/ProfilePage.tsx:456 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProfilePage.tsx:473 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/ProfilePage.tsx:487 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/ProfilePage.tsx:509 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProfilePage.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProfilePage.tsx:539 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProfilePage.tsx:572 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProfilePage.tsx:584 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/ProfilePage.tsx:598 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProfilePage.tsx:606 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProfilePage.tsx:625 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/ProfilePage.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProfilePage.tsx:645 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProfilePage.tsx:668 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProfilePage.tsx:689 — [dynamic label] — visible state, dialog, route or recorded local request

### /settings

- src/components/ApiKeysSection.tsx:152 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ApiKeysSection.tsx:161 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ApiKeysSection.tsx:172 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ApiKeysSection.tsx:197 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ApiKeysSection.tsx:206 — 例如：Zapier 集成 / 内部脚本 — value/state changes; submit persists to local seed
- src/components/ApiKeysSection.tsx:228 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ApiKeysSection.tsx:231 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ApiKeysSection.tsx:316 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ApiKeysSection.tsx:363 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ApiKeysSection.tsx:377 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ApiKeysSection.tsx:413 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ApiKeysSection.tsx:466 — 撤销 — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ModelDataRegionDialog.tsx:80 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ModelDataRegionDialog.tsx:111 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ModelDataRegionDialog.tsx:114 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/AddChannelModal.tsx:201 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/AddChannelModal.tsx:222 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/AddChannelModal.tsx:259 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/notifications/AddChannelModal.tsx:282 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/AddChannelModal.tsx:314 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/AddChannelModal.tsx:323 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationsSection.tsx:60 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/notifications/NotificationsSection.tsx:284 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationsSection.tsx:304 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationsSection.tsx:359 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationsSection.tsx:372 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/settings/AccountClosureSection.tsx:135 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/settings/AccountClosureSection.tsx:178 — 关闭账号向导 — visible state, dialog, route or recorded local request
- src/components/settings/AccountClosureSection.tsx:193 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/settings/AccountClosureSection.tsx:212 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/settings/AccountClosureSection.tsx:228 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/settings/AccountClosureSection.tsx:232 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/settings/AccountClosureSection.tsx:236 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/settings/AccountClosureSection.tsx:322 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/settings/AccountClosureSection.tsx:362 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/settings/AccountClosureSection.tsx:368 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/settings/AccountClosureSection.tsx:380 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/settings/BrowserDataSection.tsx:92 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/settings/BrowserDataSection.tsx:110 — 已选站点 — value/state changes; submit persists to local seed
- src/components/settings/BrowserDataSection.tsx:133 — localStorage 字段（选填） — value/state changes; submit persists to local seed
- src/components/settings/BrowserDataSection.tsx:144 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/settings/BrowserDataSection.tsx:158 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/settings/BrowserDataSection.tsx:166 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/settings/BrowserDataSection.tsx:232 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/settings/BrowserDataSection.tsx:247 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/settings/MemorySection.tsx:204 — 搜索 AI 记忆 — value/state changes; submit persists to local seed
- src/components/settings/MemorySection.tsx:217 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/settings/MemorySection.tsx:246 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/settings/MemorySection.tsx:290 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/settings/MemorySection.tsx:325 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/settings/MemorySection.tsx:357 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/settings/ModelDataRegionSection.tsx:59 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/SettingsPage.tsx:70 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/SettingsPage.tsx:198 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/SettingsPage.tsx:201 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/SettingsPage.tsx:204 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/SettingsPage.tsx:223 — [dynamic label] — visible state, dialog, route or recorded local request

### /settings/roles

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/RolesPage.tsx:187 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/RolesPage.tsx:190 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/RolesPage.tsx:191 — [dynamic label] — route or new target URL
- src/pages/RolesPage.tsx:238 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/RolesPage.tsx:316 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/RolesPage.tsx:324 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/RolesPage.tsx:365 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/RolesPage.tsx:394 — [dynamic label] — visible state, dialog, route or recorded local request

### /partner

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/PartnerPage.tsx:211 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PartnerPage.tsx:487 — 刷新失败，正在显示上次账本 — visible state, dialog, route or recorded local request
- src/pages/PartnerPage.tsx:506 — 合伙人账本暂时无法加载 — visible state, dialog, route or recorded local request
- src/pages/PartnerPage.tsx:734 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PartnerPage.tsx:780 — bank_fp_... — value/state changes; submit persists to local seed
- src/pages/PartnerPage.tsx:790 — bankcard-flow-... — value/state changes; submit persists to local seed
- src/pages/PartnerPage.tsx:800 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PartnerPage.tsx:830 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/PartnerPage.tsx:831 — 复制我的邀请码 — visible state, dialog, route or recorded local request
- src/pages/PartnerPage.tsx:848 — usr_... — value/state changes; submit persists to local seed
- src/pages/PartnerPage.tsx:859 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/PartnerPage.tsx:868 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PartnerPage.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PartnerPage.tsx:952 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PartnerPage.tsx:985 — 例如 5000 — value/state changes; submit persists to local seed
- src/pages/PartnerPage.tsx:997 — bank_fp_... — value/state changes; submit persists to local seed
- src/pages/PartnerPage.tsx:1008 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PartnerPage.tsx:1037 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/PartnerPage.tsx:1052 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PartnerPage.tsx:1063 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/PartnerPage.tsx:1084 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PartnerPage.tsx:1095 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PartnerPage.tsx:1136 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/PartnerPage.tsx:1211 — [dynamic label] — visible state, dialog, route or recorded local request

### /partner/recharge

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request

### /partner/ledger

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request

### /partner/withdraw

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request

### /plan

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/CnPaymentDialog.tsx:188 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/CnPaymentDialog.tsx:195 — 关闭 — visible state, dialog, route or recorded local request
- src/components/CnPaymentDialog.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/PlanPage.tsx:190 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PlanPage.tsx:202 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PlanPage.tsx:382 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PlanPage.tsx:392 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PlanPage.tsx:396 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PlanPage.tsx:401 — [dynamic label] — route or new target URL
- src/pages/PlanPage.tsx:416 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PlanPage.tsx:434 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PlanPage.tsx:473 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PlanPage.tsx:568 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PlanPage.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PlanPage.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PlanPage.tsx:637 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PlanPage.tsx:643 — [dynamic label] — route or new target URL

### /billing

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/billing/PaymentLedgerSection.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/billing/PaymentLedgerSection.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/billing/PaymentLedgerSection.tsx:320 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/billing/PaymentLedgerSection.tsx:331 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/billing/PaymentLedgerSection.tsx:394 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/billing/PaymentLedgerSection.tsx:405 — [dynamic label] — route or new target URL
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/BillingPage.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BillingPage.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BillingPage.tsx:179 — [dynamic label] — route or new target URL
- src/pages/BillingPage.tsx:201 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BillingPage.tsx:225 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BillingPage.tsx:231 — [dynamic label] — route or new target URL
- src/pages/BillingPage.tsx:242 — [dynamic label] — route or new target URL
- src/pages/BillingPage.tsx:271 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BillingPage.tsx:277 — [dynamic label] — route or new target URL

### /usage

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/UsagePage.tsx:87 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/UsagePage.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/UsagePage.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/UsagePage.tsx:144 — [dynamic label] — route or new target URL
- src/pages/UsagePage.tsx:181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/UsagePage.tsx:184 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/UsagePage.tsx:190 — [dynamic label] — route or new target URL
- src/pages/UsagePage.tsx:298 — [dynamic label] — visible state, dialog, route or recorded local request

### /cosmic

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/AstrologyDimensionGrid.tsx:73 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/AstrologyDimensionGrid.tsx:95 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/AstrologyPortalRow.tsx:53 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/AstrologyWorld.tsx:113 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/AstrologyWorld.tsx:131 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/AstrologyWorld.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/AstrologyWorld.tsx:162 — 刷新当前星座范围 — visible state, dialog, route or recorded local request
- src/components/energy/AstrologyWorld.tsx:256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/AstrologyWorld.tsx:276 — [dynamic label] — route or new target URL
- src/components/energy/EnergyAstrologyPanel.tsx:24 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyAstrologyPanel.tsx:28 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyAstrologyPanel.tsx:36 — 刷新星座能量 — visible state, dialog, route or recorded local request
- src/components/energy/EnergyContinueCard.tsx:24 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyContinueCard.tsx:32 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyContinueCard.tsx:43 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyExperienceDeck.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyExploreFeed.tsx:184 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyExploreFeed.tsx:238 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyExploreFeed.tsx:247 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyExploreFeed.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyExploreFeed.tsx:261 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyExploreFeed.tsx:273 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyHero.tsx:90 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyHero.tsx:99 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyHero.tsx:127 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyHero.tsx:150 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyMagazineCard.tsx:81 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyMagazineCard.tsx:101 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyProfileDrawer.tsx:85 — 关闭个人资料 — visible state, dialog, route or recorded local request
- src/components/energy/EnergyProfileDrawer.tsx:104 — 生日 — value/state changes; submit persists to local seed
- src/components/energy/EnergyProfileDrawer.tsx:117 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyProfileDrawer.tsx:131 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/energy/EnergyProfileDrawer.tsx:142 — 例如：Tokyo — value/state changes; submit persists to local seed
- src/components/energy/EnergyProfileDrawer.tsx:157 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyProfileDrawer.tsx:164 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyProfileDrawer.tsx:180 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyProfileDrawer.tsx:183 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergySectionNav.tsx:56 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyShelf.tsx:42 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyShelf.tsx:56 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyShelf.tsx:151 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyShelf.tsx:172 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/EnergyShelf.tsx:207 — [dynamic label] — route or new target URL
- src/components/energy/ExperiencePlayer.tsx:100 — 关闭体验 — visible state, dialog, route or recorded local request
- src/components/energy/ExperiencePlayer.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/ExperiencePlayer.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/ExperiencePlayer.tsx:141 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/RunningTaskDock.tsx:86 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request

### /history

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/HistoryPage.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/HistoryPage.tsx:305 — 搜索任务内容 — value/state changes; submit persists to local seed
- src/pages/HistoryPage.tsx:331 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/HistoryPage.tsx:340 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/HistoryPage.tsx:346 — [dynamic label] — route or new target URL
- src/pages/HistoryPage.tsx:366 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/HistoryPage.tsx:391 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/HistoryPage.tsx:431 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/HistoryPage.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/HistoryPage.tsx:474 — [dynamic label] — visible state, dialog, route or recorded local request

### /skills

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/AttachmentChip.tsx:120 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AttachmentChip.tsx:129 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/skills/ApprovedSkillsCatalog.tsx:42 — 搜索技能 — value/state changes; submit persists to local seed
- src/components/skills/ApprovedSkillsCatalog.tsx:52 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/skills/ApprovedSkillsCatalog.tsx:60 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/skills/ApprovedSkillsCatalog.tsx:84 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/skills/ApprovedSkillsCatalog.tsx:100 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/skills/ApprovedSkillsCatalog.tsx:123 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/skills/ApprovedSkillsCatalog.tsx:164 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/skills/ApprovedSkillsCatalog.tsx:181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/skills/ApprovedSkillsCatalog.tsx:214 — 使用说明 — visible state, dialog, route or recorded local request
- src/components/skills/ApprovedSkillsCatalog.tsx:218 — 这次任务的要求 — value/state changes; submit persists to local seed
- src/components/skills/ApprovedSkillsCatalog.tsx:236 — 技能任务资料 — value/state changes; submit persists to local seed
- src/components/skills/ApprovedSkillsCatalog.tsx:247 — 添加资料 — visible state, dialog, route or recorded local request
- src/components/skills/ApprovedSkillsCatalog.tsx:259 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/skills/CapabilityCenterContent.tsx:204 — [dynamic label] — route or new target URL
- src/components/skills/CapabilityCenterContent.tsx:228 — 移除已选任务 — visible state, dialog, route or recorded local request
- src/components/skills/CapabilityCenterContent.tsx:279 — 描述想完成的任务 — value/state changes; submit persists to local seed
- src/components/skills/CapabilityCenterContent.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/skills/CapabilityCenterContent.tsx:338 — 添加附件 — visible state, dialog, route or recorded local request
- src/components/skills/CapabilityCenterContent.tsx:354 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/skills/CapabilityCenterContent.tsx:355 — 选择任务使用的技能 — visible state, dialog, route or recorded local request
- src/components/skills/CapabilityCenterContent.tsx:392 — 搜索技能 — value/state changes; submit persists to local seed
- src/components/skills/CapabilityCenterContent.tsx:403 — 自动匹配 — visible state, dialog, route or recorded local request
- src/components/skills/CapabilityCenterContent.tsx:424 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/skills/CapabilityCenterContent.tsx:453 — 选择任务附件 — value/state changes; submit persists to local seed
- src/components/skills/CapabilityCenterContent.tsx:507 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/skills/CapabilityCenterContent.tsx:535 — 执行预览 — visible state, dialog, route or recorded local request
- src/components/skills/CapabilityCenterContent.tsx:595 — 选择这个任务示例 — visible state, dialog, route or recorded local request
- src/components/skills/CapabilityCenterContent.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/skills/CapabilityCenterContent.tsx:689 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/skills/CapabilityCenterContent.tsx:707 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/SkillsPage.tsx:257 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/SkillsPage.tsx:260 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/SkillsPage.tsx:261 — [dynamic label] — route or new target URL
- src/pages/SkillsPage.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/SkillsPage.tsx:286 — [dynamic label] — route or new target URL

### /stocks

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/AttachmentChip.tsx:120 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AttachmentChip.tsx:129 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/CreativeReferenceLibrary.tsx:104 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/CreativeReferenceLibrary.tsx:114 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/CreativeReferenceLibrary.tsx:120 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/CreativeReferenceLibrary.tsx:159 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/CreativeReferenceLibrary.tsx:164 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/CreativeReferenceLibrary.tsx:175 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/DiscoveryNewsCard.tsx:33 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/NewsDetailModal.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/NewsDetailModal.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/NewsDetailModal.tsx:148 — 关闭 — visible state, dialog, route or recorded local request
- src/components/NewsDetailModal.tsx:225 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/NewsDetailModal.tsx:237 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/NewsDetailModal.tsx:264 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/ApprovedStockComposer.tsx:128 — 选择研究范围 — visible state, dialog, route or recorded local request
- src/components/stocks/ApprovedStockComposer.tsx:143 — 管理关注股票 — visible state, dialog, route or recorded local request
- src/components/stocks/ApprovedStockComposer.tsx:147 — 选择时间范围 — visible state, dialog, route or recorded local request
- src/components/stocks/ApprovedStockComposer.tsx:157 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/ApprovedStockComposer.tsx:182 — 选择参考资料 — visible state, dialog, route or recorded local request
- src/components/stocks/ApprovedStockComposer.tsx:201 — 移除参考资料 — visible state, dialog, route or recorded local request
- src/components/stocks/ApprovedStockComposer.tsx:218 — 交代股市研究任务 — value/state changes; submit persists to local seed
- src/components/stocks/ApprovedStockComposer.tsx:238 — 添加本地资料 — visible state, dialog, route or recorded local request
- src/components/stocks/ApprovedStockComposer.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/ApprovedStockComposer.tsx:261 — 选择输出内容 — visible state, dialog, route or recorded local request
- src/components/stocks/ApprovedStockComposer.tsx:273 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/ApprovedStockComposer.tsx:282 — 提交股市任务 — visible state, dialog, route or recorded local request
- src/components/stocks/ApprovedStockComposer.tsx:295 — 研究建议 — visible state, dialog, route or recorded local request
- src/components/stocks/ApprovedStockComposer.tsx:298 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/ApprovedStockComposer.tsx:312 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/stocks/ApprovedStockComposer.tsx:354 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/ApprovedStockComposer.tsx:355 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/ApprovedStockComposer.tsx:363 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockAiCommandComposer.tsx:75 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockAiCommandComposer.tsx:100 — 管理研究范围 — visible state, dialog, route or recorded local request
- src/components/stocks/StockAiCommandComposer.tsx:100 — 管理研究范围 — visible state, dialog, route or recorded local request
- src/components/stocks/StockAiCommandComposer.tsx:110 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/stocks/StockAiCommandComposer.tsx:110 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/stocks/StockAiCommandComposer.tsx:111 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockAiCommandComposer.tsx:112 — 提交股市任务 — visible state, dialog, route or recorded local request
- src/components/stocks/StockAiCommandComposer.tsx:135 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockPreferenceProfile.tsx:190 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockPreferenceProfile.tsx:201 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockPreferenceProfile.tsx:213 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockPreferenceProfile.tsx:309 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockPreferenceProfile.tsx:331 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockPreferenceProfile.tsx:360 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockPreferenceProfile.tsx:486 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockPreferenceProfile.tsx:637 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/stocks/StockPreferenceProfile.tsx:673 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockPreferenceProfile.tsx:683 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockPreferenceProfile.tsx:696 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockPreferenceProfile.tsx:704 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockRiskMonitorSheet.tsx:82 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockRiskMonitorSheet.tsx:90 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockRiskRadar.tsx:323 — 刷新风险雷达 — visible state, dialog, route or recorded local request
- src/components/stocks/StockRiskRadar.tsx:549 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockRiskRadar.tsx:571 — [dynamic label] — route or new target URL
- src/components/stocks/StockRiskRadar.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockRiskRadar.tsx:678 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockRiskRadar.tsx:707 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockRiskRadar.tsx:719 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockRiskRadar.tsx:730 — [dynamic label] — route or new target URL
- src/components/stocks/StockScreeningWorkbench.tsx:184 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/stocks/StockScreeningWorkbench.tsx:190 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockScreeningWorkbench.tsx:201 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockScreeningWorkbench.tsx:222 — 清空筛选条件 — visible state, dialog, route or recorded local request
- src/components/stocks/StockScreeningWorkbench.tsx:235 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockScreeningWorkbench.tsx:264 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockScreeningWorkbench.tsx:408 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/stocks/StockScreeningWorkbench.tsx:425 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/stocks/StockScreeningWorkbench.tsx:507 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockScreeningWorkbench.tsx:554 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockScreeningWorkbench.tsx:592 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockWorkbenchLayout.tsx:109 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockWorkbenchLayout.tsx:214 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockWorkbenchLayout.tsx:284 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:699 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:708 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:739 — setWorkspaceTask('risk')}>查看风险证据 — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:739 — setWorkspaceTask('risk')}>查看风险证据 — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:742 — setInsightSheet(marketInsight(marketIndices, dashboardTrust.tone))}> — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:1051 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:1097 — 上一页动态 — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:1108 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:1124 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:1137 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:1205 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:1244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:1414 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:1559 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/StockTasksPage.tsx:1575 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/StockTasksPage.tsx:1600 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:1619 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/StockTasksPage.tsx:1628 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/StockTasksPage.tsx:1635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:1679 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/StockTasksPage.tsx:1691 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/StockTasksPage.tsx:1706 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:1714 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:2189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:2235 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:2272 — [dynamic label] — visible state, dialog, route or recorded local request

### /stocks/discovery

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/DiscoveryNewsCard.tsx:33 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/NewsDetailModal.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/NewsDetailModal.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/NewsDetailModal.tsx:148 — 关闭 — visible state, dialog, route or recorded local request
- src/components/NewsDetailModal.tsx:225 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/NewsDetailModal.tsx:237 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/NewsDetailModal.tsx:264 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/StockDiscoveryPage.tsx:220 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockDiscoveryPage.tsx:237 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockDiscoveryPage.tsx:252 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockDiscoveryPage.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request

### /projects

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/OrganizationInviteDialog.tsx:149 — 关闭邀请对话框 — visible state, dialog, route or recorded local request
- src/components/projects/OrganizationInviteDialog.tsx:173 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/projects/OrganizationInviteDialog.tsx:184 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/OrganizationInviteDialog.tsx:187 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/OrganizationInviteDialog.tsx:202 — 成员角色 — value/state changes; submit persists to local seed
- src/components/projects/OrganizationInviteDialog.tsx:218 — 直属上级（可选） — value/state changes; submit persists to local seed
- src/components/projects/OrganizationInviteDialog.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/OrganizationInviteDialog.tsx:242 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/OrganizationMembersPanel.tsx:107 — 刷新团队成员 — visible state, dialog, route or recorded local request
- src/components/projects/OrganizationMembersPanel.tsx:168 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/projects/OrganizationMembersPanel.tsx:191 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/projects/OrganizationMembersPanel.tsx:212 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/OrganizationMembersPanel.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/PersonalProjectDetail.tsx:79 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/PersonalProjectDetail.tsx:83 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/PersonalProjectDetail.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/PersonalProjectDetail.tsx:120 — 搜索项目任务 — value/state changes; submit persists to local seed
- src/components/projects/PersonalProjectDetail.tsx:131 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/PersonalProjectDetail.tsx:137 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/PersonalProjectDetail.tsx:156 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/WorkspaceSwitcher.tsx:42 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/WorkspaceSwitcher.tsx:42 — 切换工作区 — visible state, dialog, route or recorded local request
- src/components/projects/WorkspaceSwitcher.tsx:43 — onSelectOrganization(null)}> — visible state, dialog, route or recorded local request
- src/components/projects/WorkspaceSwitcher.tsx:44 — onSelectOrganization(organization.organizationId)}> — visible state, dialog, route or recorded local request
- src/components/projects/WorkspaceSwitcher.tsx:47 — 刷新团队空间 — visible state, dialog, route or recorded local request
- src/components/projects/WorkspaceSwitcher.tsx:59 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/WorkspaceSwitcher.tsx:78 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:759 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:770 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:785 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:815 — 搜索项目 — value/state changes; submit persists to local seed
- src/pages/ProjectsPage.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:1036 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:1056 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:1073 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:1094 — onOpen(project)}> — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:1096 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:1120 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:1121 — 更多 — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:1134 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:1139 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:1201 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/ProjectsPage.tsx:1232 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:1244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:1290 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:1367 — 关闭 — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:1379 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/ProjectsPage.tsx:1394 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:1404 — [dynamic label] — visible state, dialog, route or recorded local request

### /projects/:projectId

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:264 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:267 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:267 — 搜索项目任务 — value/state changes; submit persists to local seed
- src/components/projects/TeamTaskWorkbench.tsx:268 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:268 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:268 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:289 — 项目进展与权限 — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:326 — onSelect(row.id)}> — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:410 — 列表视图 — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:423 — 看板视图 — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:438 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:460 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:617 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:740 — 关闭任务详情 — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:841 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:858 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:859 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:862 — 复核时间 — value/state changes; submit persists to local seed
- src/components/projects/TeamTaskWorkbench.tsx:871 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/projects/TeamTaskWorkbench.tsx:878 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:900 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:901 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:902 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:918 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:919 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:932 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:941 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:954 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:961 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:968 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:975 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:993 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1135 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1144 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1165 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/projects/TeamTaskWorkbench.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1182 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1185 — 新截止时间 — value/state changes; submit persists to local seed
- src/components/projects/TeamTaskWorkbench.tsx:1194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1203 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1227 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/projects/TeamTaskWorkbench.tsx:1348 — 关闭新建任务 — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1360 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1389 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1402 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1411 — 里程碑 — value/state changes; submit persists to local seed
- src/components/projects/TeamTaskWorkbench.tsx:1427 — 依赖任务 — value/state changes; submit persists to local seed
- src/components/projects/TeamTaskWorkbench.tsx:1449 — 截止时间 — value/state changes; submit persists to local seed
- src/components/projects/TeamTaskWorkbench.tsx:1468 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1469 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1472 — 验收标准 1 — value/state changes; submit persists to local seed
- src/components/projects/TeamTaskWorkbench.tsx:1486 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1492 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1498 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1517 — 我已复核验收契约 — value/state changes; submit persists to local seed
- src/components/projects/TeamTaskWorkbench.tsx:1533 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1561 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/projects/TeamTaskWorkbench.tsx:1592 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/projects/TeamTaskWorkbench.tsx:1637 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/TeamProjectPage.tsx:558 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/TeamProjectPage.tsx:686 — [dynamic label] — visible state, dialog, route or recorded local request

### /organizations/invitations/accept

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/OrganizationInvitationAcceptPage.tsx:125 — [dynamic label] — visible state, dialog, route or recorded local request

### /starred

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/StarredPage.tsx:177 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StarredPage.tsx:180 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StarredPage.tsx:186 — [dynamic label] — route or new target URL
- src/pages/StarredPage.tsx:225 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StarredPage.tsx:246 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StarredPage.tsx:268 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StarredPage.tsx:281 — [dynamic label] — visible state, dialog, route or recorded local request

### /files

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FilePreviewModal.tsx:228 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FilePreviewModal.tsx:234 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FilePreviewModal.tsx:250 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FilePreviewModal.tsx:268 — 关闭预览 — visible state, dialog, route or recorded local request
- src/components/FilePreviewModal.tsx:340 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FilePreviewModal.tsx:363 — 用于新任务 — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:345 — 搜索文件名 — value/state changes; submit persists to local seed
- src/pages/FilesPage.tsx:350 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:351 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:361 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:369 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:369 — 文件排序 — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:372 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:377 — 网格视图 — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:378 — 列表视图 — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:381 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:434 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:488 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:552 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:605 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:642 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:678 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:695 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:696 — 更多操作 — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:707 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:711 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:715 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:719 — [dynamic label] — visible state, dialog, route or recorded local request

### /video

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request

### /video/edit/:projectId

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request

### /image

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/AttachmentChip.tsx:120 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AttachmentChip.tsx:129 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/CreativeInspiration.tsx:85 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/CreativeInspiration.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/CreativeInspiration.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/CreativeInspiration.tsx:167 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/CreativeProjectPicker.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/CreativeProjectPicker.tsx:88 — 选择项目 — visible state, dialog, route or recorded local request
- src/components/CreativeProjectPicker.tsx:112 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/CreativeProjectPicker.tsx:124 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/CreativeProjectPicker.tsx:151 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/CreativeReferenceLibrary.tsx:104 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/CreativeReferenceLibrary.tsx:114 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/CreativeReferenceLibrary.tsx:120 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/CreativeReferenceLibrary.tsx:159 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/CreativeReferenceLibrary.tsx:164 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/CreativeReferenceLibrary.tsx:175 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FileDownloadCard.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FileDownloadCard.tsx:295 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/image/ImageBriefComposer.tsx:88 — 移除主角图 — visible state, dialog, route or recorded local request
- src/components/image/ImageBriefComposer.tsx:101 — 更换主角图 — visible state, dialog, route or recorded local request
- src/components/image/ImageBriefComposer.tsx:122 — 更换主角图 — visible state, dialog, route or recorded local request
- src/components/image/ImageBriefComposer.tsx:135 — 添加主角图 — visible state, dialog, route or recorded local request
- src/components/image/ImageBriefComposer.tsx:163 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/image/ImageBriefComposer.tsx:195 — 添加参考资料 — visible state, dialog, route or recorded local request
- src/components/image/ImageBriefComposer.tsx:202 — 描述你想要的最终画面 — value/state changes; submit persists to local seed
- src/components/image/ImageBriefComposer.tsx:224 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/image/ImageGenerationSettings.tsx:41 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/image/ImageGenerationSettings.tsx:83 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/image/ImageGenerationSettings.tsx:117 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/image/ImageGenerationSettings.tsx:130 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/image/ImageGenerationSettings.tsx:167 — 关闭生成设置 — visible state, dialog, route or recorded local request
- src/components/image/ImageGenerationSettings.tsx:206 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/image/ImageGoalPicker.tsx:7 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/image/ImageGoalPicker.tsx:9 — onCommercialUseChange(use.id)}> — visible state, dialog, route or recorded local request
- src/components/image/ImageHistory.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/image/ImageHistory.tsx:196 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/image/ImageHistory.tsx:211 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/image/ImageHistory.tsx:242 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/image/ImageResultPanel.tsx:165 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/image/ImageResultPanel.tsx:174 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/image/ImageResultPanel.tsx:201 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/image/ImageResultPanel.tsx:211 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/textarea.tsx:9 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/ImagePage.tsx:418 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ImagePage.tsx:429 — 添加图片 — value/state changes; submit persists to local seed
- src/pages/ImagePage.tsx:440 — 选择图片模型 — visible state, dialog, route or recorded local request
- src/pages/ImagePage.tsx:440 — 选择图片模型 — visible state, dialog, route or recorded local request
- src/pages/ImagePage.tsx:440 — 选择图片模型 — visible state, dialog, route or recorded local request
- src/pages/ImagePage.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request

### /planned

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/textarea.tsx:9 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedScopeDialog.tsx:50 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedScopeDialog.tsx:53 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedScopeDialog.tsx:56 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedScopeDialog.tsx:60 — 取消 — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:747 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:748 — 旧任务记录 — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:754 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:758 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:764 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:773 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:781 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:790 — 查找规划 — value/state changes; submit persists to local seed
- src/pages/planned/PlannedTasksPage.tsx:822 — 上一个月 — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:831 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:834 — 下一个月 — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:890 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:898 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:909 — 添加当天安排 — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:914 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:921 — openCreate(selectedDay)}> — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:940 — 关闭 — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:953 — 名称 — value/state changes; submit persists to local seed
- src/pages/planned/PlannedTasksPage.tsx:963 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:993 — 描述这个任务 — value/state changes; submit persists to local seed
- src/pages/planned/PlannedTasksPage.tsx:1009 — 移除任务 — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:1026 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:1044 — 任务说明 — value/state changes; submit persists to local seed
- src/pages/planned/PlannedTasksPage.tsx:1073 — 统一要求（可选） — value/state changes; submit persists to local seed
- src/pages/planned/PlannedTasksPage.tsx:1085 — 日期 — value/state changes; submit persists to local seed
- src/pages/planned/PlannedTasksPage.tsx:1101 — 时间 — value/state changes; submit persists to local seed
- src/pages/planned/PlannedTasksPage.tsx:1129 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:1161 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:1195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:1203 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:1213 — 结束日期 — value/state changes; submit persists to local seed
- src/pages/planned/PlannedTasksPage.tsx:1226 — 时区 — value/state changes; submit persists to local seed
- src/pages/planned/PlannedTasksPage.tsx:1238 — 提前提醒 — value/state changes; submit persists to local seed
- src/pages/planned/PlannedTasksPage.tsx:1266 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:1270 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:1278 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:1345 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:1351 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:1451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:1460 — [dynamic label] — visible state, dialog, route or recorded local request

### /planned/legacy-scheduled

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ScheduledTaskDialog.tsx:202 — 新建定时任务 — visible state, dialog, route or recorded local request
- src/components/ScheduledTaskDialog.tsx:209 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ScheduledTaskDialog.tsx:224 — 关闭 — visible state, dialog, route or recorded local request
- src/components/ScheduledTaskDialog.tsx:240 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ScheduledTaskDialog.tsx:257 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ScheduledTaskDialog.tsx:276 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ScheduledTaskDialog.tsx:300 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ScheduledTaskDialog.tsx:321 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ScheduledTaskDialog.tsx:339 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ScheduledTaskDialog.tsx:353 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ScheduledTaskDialog.tsx:368 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ScheduledTaskDialog.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ScheduledTaskDialog.tsx:394 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/ScheduledPage.tsx:120 — 定时任务 — visible state, dialog, route or recorded local request
- src/pages/ScheduledPage.tsx:216 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ScheduledPage.tsx:230 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ScheduledPage.tsx:291 — [dynamic label] — visible state, dialog, route or recorded local request

### /planned/legacy-batch

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:223 — 新建批量任务 — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:230 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:239 — 关闭 — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:255 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/BatchTaskDialog.tsx:314 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:347 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:363 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:381 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/BatchTaskDialog.tsx:416 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/BatchTaskDialog.tsx:433 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/BatchTaskDialog.tsx:447 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:463 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:208 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:275 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:325 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:487 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:577 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:644 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:713 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:723 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:730 — [dynamic label] — route or new target URL
- src/pages/BatchPage.tsx:765 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:768 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:775 — [dynamic label] — route or new target URL

### /scheduled

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request

### /batch

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request

### /batch/:batchId

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:223 — 新建批量任务 — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:230 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:239 — 关闭 — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:255 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/BatchTaskDialog.tsx:314 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:347 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:363 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:381 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/BatchTaskDialog.tsx:416 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/BatchTaskDialog.tsx:433 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/BatchTaskDialog.tsx:447 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:463 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:208 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:275 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:325 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:487 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:577 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:644 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:713 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:723 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:730 — [dynamic label] — route or new target URL
- src/pages/BatchPage.tsx:765 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:768 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:775 — [dynamic label] — route or new target URL

### /connections

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/ConnectionsPage.tsx:140 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ConnectionsPage.tsx:143 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ConnectionsPage.tsx:144 — [dynamic label] — route or new target URL
- src/pages/ConnectionsPage.tsx:162 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ConnectionsPage.tsx:163 — [dynamic label] — route or new target URL
- src/pages/ConnectionsPage.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ConnectionsPage.tsx:257 — [dynamic label] — route or new target URL

### *

- src/components/AppShell.tsx:1067 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1168 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:106 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:133 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:194 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:399 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:408 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:411 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:454 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:463 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:470 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:490 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:497 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:504 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:512 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:513 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:535 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:536 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:546 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:558 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:559 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:567 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:573 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:581 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:589 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:624 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:660 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:718 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:731 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:755 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:788 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:824 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:833 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:195 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:203 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:214 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:236 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:266 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:448 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:461 — setHistoryExpanded(value => !value)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:587 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:631 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:633 — setBatchMode(true)}> — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:634 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:769 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:778 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:792 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:798 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:810 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:846 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:945 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:974 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1086 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1090 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1115 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:71 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:170 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:201 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:245 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:190 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:251 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:406 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:436 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:479 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:588 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:610 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:620 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:35 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:265 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:290 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:332 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:57 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/NotFoundPage.tsx:17 — 返回首页 — visible state, dialog, route or recorded local request
- src/pages/NotFoundPage.tsx:19 — [dynamic label] — visible state, dialog, route or recorded local request

## Interactive component candidates

Shared components may appear on multiple pages. Source line identities are stable; runtime inventories supply the page × component × outcome mapping.

| Source | Component | Label | Expected behavior |
| --- | --- | --- | --- |
| src/WorkbenchApp.tsx:877 | button | 收起浏览器 | visible state, dialog, route or recorded local request |
| src/components/AdminLayout.tsx:121 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ApiKeysSection.tsx:152 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ApiKeysSection.tsx:161 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ApiKeysSection.tsx:172 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ApiKeysSection.tsx:197 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ApiKeysSection.tsx:206 | input | 例如：Zapier 集成 / 内部脚本 | value/state changes; submit persists to local seed |
| src/components/ApiKeysSection.tsx:228 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ApiKeysSection.tsx:231 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ApiKeysSection.tsx:316 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ApiKeysSection.tsx:363 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ApiKeysSection.tsx:377 | summary | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ApiKeysSection.tsx:413 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ApiKeysSection.tsx:466 | button | 撤销 | visible state, dialog, route or recorded local request |
| src/components/AppShell.tsx:1067 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/AppShell.tsx:1168 | Button | 浏览器工作区 | visible state, dialog, route or recorded local request |
| src/components/AttachmentChip.tsx:120 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/AttachmentChip.tsx:129 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BatchTaskDialog.tsx:223 | div | 新建批量任务 | visible state, dialog, route or recorded local request |
| src/components/BatchTaskDialog.tsx:230 | div | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BatchTaskDialog.tsx:239 | button | 关闭 | visible state, dialog, route or recorded local request |
| src/components/BatchTaskDialog.tsx:255 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/BatchTaskDialog.tsx:314 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BatchTaskDialog.tsx:347 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BatchTaskDialog.tsx:363 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BatchTaskDialog.tsx:381 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/BatchTaskDialog.tsx:416 | textarea | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/BatchTaskDialog.tsx:433 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/BatchTaskDialog.tsx:447 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BatchTaskDialog.tsx:463 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BatchTaskDialog.tsx:471 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:1345 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:1367 | button | 收起浏览器 | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:1437 | button | 退出全屏 (Esc) | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:1495 | button | 停止当前任务 | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:1513 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:1549 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:1745 | img | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:1777 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:1805 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:1860 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:1883 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:1903 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:1914 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:1961 | div | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:2079 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:2097 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:2113 | button | 全屏查看任务截图 | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:2208 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:2259 | button | 收起操作日志 | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:2323 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/BrowserPanel.tsx:2415 | input | 中文 / 任意文本输入（先点击页面上的输入框获得焦点） | value/state changes; submit persists to local seed |
| src/components/BrowserPanel.tsx:2434 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:2448 | button | 关闭浮动输入框 | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:2511 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:2613 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:2666 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:2992 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/BrowserPanel.tsx:3037 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:3082 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:3244 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:3261 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserReplay.tsx:46 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserReplay.tsx:55 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserReplay.tsx:65 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserReplay.tsx:99 | input | 回放时间轴 | value/state changes; submit persists to local seed |
| src/components/BrowserReplay.tsx:115 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserViewportToolbar.tsx:67 | Button | 适应画面 | visible state, dialog, route or recorded local request |
| src/components/BrowserViewportToolbar.tsx:78 | Button | 按原尺寸显示 | visible state, dialog, route or recorded local request |
| src/components/BrowserViewportToolbar.tsx:88 | Button | 放大画面 | visible state, dialog, route or recorded local request |
| src/components/BrowserViewportToolbar.tsx:107 | Button | 缩小画面 | visible state, dialog, route or recorded local request |
| src/components/BrowserViewportToolbar.tsx:119 | DropdownMenuTrigger | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserViewportToolbar.tsx:120 | Button | 平移画面 | visible state, dialog, route or recorded local request |
| src/components/BrowserViewportToolbar.tsx:140 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserViewportToolbar.tsx:148 | DropdownMenuTrigger | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserViewportToolbar.tsx:149 | Button | 网页显示模式 | visible state, dialog, route or recorded local request |
| src/components/BrowserViewportToolbar.tsx:168 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/CdpScreencastViewport.tsx:53 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/CdpScreencastViewport.tsx:832 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/CnPaymentDialog.tsx:188 | div | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/CnPaymentDialog.tsx:195 | button | 关闭 | visible state, dialog, route or recorded local request |
| src/components/CnPaymentDialog.tsx:285 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ConfirmDialog.tsx:106 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ConfirmDialog.tsx:116 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/CreativeDisclosure.tsx:10 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/CreativeInspiration.tsx:85 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/CreativeInspiration.tsx:98 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/CreativeInspiration.tsx:142 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/CreativeInspiration.tsx:167 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/CreativeProjectPicker.tsx:35 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/CreativeProjectPicker.tsx:88 | button | 选择项目 | visible state, dialog, route or recorded local request |
| src/components/CreativeProjectPicker.tsx:112 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/CreativeProjectPicker.tsx:124 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/CreativeProjectPicker.tsx:151 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/CreativeReferenceLibrary.tsx:104 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/CreativeReferenceLibrary.tsx:114 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/CreativeReferenceLibrary.tsx:120 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/CreativeReferenceLibrary.tsx:159 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/CreativeReferenceLibrary.tsx:164 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/CreativeReferenceLibrary.tsx:175 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/DiscoveryNewsCard.tsx:33 | article | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/FailureHeaderCard.tsx:85 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/FailureHeaderCard.tsx:114 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/FeedbackDialog.tsx:98 | div | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/FeedbackDialog.tsx:107 | div | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/FeedbackDialog.tsx:111 | button | 关闭 | visible state, dialog, route or recorded local request |
| src/components/FeedbackDialog.tsx:133 | textarea | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/FeedbackDialog.tsx:185 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/FeedbackDialog.tsx:194 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/FileDownloadCard.tsx:285 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/FileDownloadCard.tsx:295 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/FilePreviewModal.tsx:228 | div | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/FilePreviewModal.tsx:234 | div | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/FilePreviewModal.tsx:250 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/FilePreviewModal.tsx:268 | button | 关闭预览 | visible state, dialog, route or recorded local request |
| src/components/FilePreviewModal.tsx:340 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/FilePreviewModal.tsx:363 | button | 用于新任务 | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:752 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:766 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:794 | Textarea | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/InputArea.tsx:837 | DropdownMenuTrigger | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:838 | button | 附件与任务选项 | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:857 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:872 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:885 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:913 | DropdownMenuRadioGroup | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:958 | DropdownMenuRadioGroup | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:1000 | button | 添加图片 | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:1002 | DropdownMenuTrigger | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:1002 | button | 选择技能 | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:1004 | DropdownMenuItem | applySkillMention(skill)}> | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:1012 | DropdownMenuTrigger | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:1012 | button | 执行模式 | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:1013 | DropdownMenuRadioGroup | setTaskMode(mode as 'auto' \| 'plan')}> | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:1015 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:1017 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/InputArea.tsx:1018 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/InputArea.tsx:1029 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:1097 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:1272 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:1407 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:1416 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LazyLoadBoundary.tsx:113 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LazyLoadBoundary.tsx:135 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LocalChromePicker.tsx:59 | DropdownMenuTrigger | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LocalChromePicker.tsx:60 | button | 选择 Chrome 页面 | visible state, dialog, route or recorded local request |
| src/components/LocalChromePicker.tsx:116 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LocalChromePicker.tsx:132 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LocalChromePicker.tsx:147 | button | 移除 Chrome 页面 | visible state, dialog, route or recorded local request |
| src/components/LocalChromeTaskPanel.tsx:23 | button | 关闭浏览器面板 | visible state, dialog, route or recorded local request |
| src/components/LocalChromeTaskPanel.tsx:32 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LocalChromeTaskPanel.tsx:33 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:399 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/LoginGate.tsx:408 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:411 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:445 | TabButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:449 | TabButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:454 | TabButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:463 | EmailInput | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/LoginGate.tsx:464 | PasswordInput | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/LoginGate.tsx:470 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:482 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:490 | EmailInput | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/LoginGate.tsx:491 | PasswordInput | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/LoginGate.tsx:497 | PasswordInput | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/LoginGate.tsx:504 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:512 | EmailInput | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/LoginGate.tsx:513 | CodeRow | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:523 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:535 | PhoneInput | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/LoginGate.tsx:536 | CodeRow | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:546 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:558 | EmailInput | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/LoginGate.tsx:559 | CodeRow | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:567 | PasswordInput | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/LoginGate.tsx:573 | PasswordInput | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/LoginGate.tsx:581 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:589 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:608 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:624 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:635 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:660 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:718 | input | 6 位数字 | value/state changes; submit persists to local seed |
| src/components/LoginGate.tsx:731 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:755 | input | you@example.com | value/state changes; submit persists to local seed |
| src/components/LoginGate.tsx:788 | input | 138 0000 0000 | value/state changes; submit persists to local seed |
| src/components/LoginGate.tsx:824 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/LoginGate.tsx:833 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/MainPanel.tsx:178 | Button | 打开任务列表 | visible state, dialog, route or recorded local request |
| src/components/MainPanel.tsx:391 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ModelDataRegionDialog.tsx:80 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/ModelDataRegionDialog.tsx:111 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ModelDataRegionDialog.tsx:114 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/NewsDetailModal.tsx:128 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/NewsDetailModal.tsx:138 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/NewsDetailModal.tsx:148 | button | 关闭 | visible state, dialog, route or recorded local request |
| src/components/NewsDetailModal.tsx:225 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/NewsDetailModal.tsx:237 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/NewsDetailModal.tsx:264 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/PlanCard.tsx:87 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/PlanCard.tsx:136 | a | [dynamic label] | route or new target URL |
| src/components/QuotaIndicator.tsx:118 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/QuotaIndicator.tsx:142 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/QuotaIndicator.tsx:173 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/QuotaIndicator.tsx:248 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/RoleNudgeBanner.tsx:86 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/RoleNudgeBanner.tsx:93 | button | 关闭角色引导 | visible state, dialog, route or recorded local request |
| src/components/ScheduledTaskDialog.tsx:202 | div | 新建定时任务 | visible state, dialog, route or recorded local request |
| src/components/ScheduledTaskDialog.tsx:209 | div | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ScheduledTaskDialog.tsx:224 | button | 关闭 | visible state, dialog, route or recorded local request |
| src/components/ScheduledTaskDialog.tsx:240 | textarea | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/ScheduledTaskDialog.tsx:257 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/ScheduledTaskDialog.tsx:276 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ScheduledTaskDialog.tsx:300 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ScheduledTaskDialog.tsx:321 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ScheduledTaskDialog.tsx:339 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/ScheduledTaskDialog.tsx:353 | textarea | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/ScheduledTaskDialog.tsx:368 | textarea | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/ScheduledTaskDialog.tsx:386 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ScheduledTaskDialog.tsx:394 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/SearchOverlay.tsx:189 | div | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/SearchOverlay.tsx:195 | div | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/SearchOverlay.tsx:203 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/SearchOverlay.tsx:214 | button | 关闭 | visible state, dialog, route or recorded local request |
| src/components/SearchOverlay.tsx:236 | button | 重试搜索 | visible state, dialog, route or recorded local request |
| src/components/SearchOverlay.tsx:266 | Button | 重试搜索 | visible state, dialog, route or recorded local request |
| src/components/SearchOverlay.tsx:288 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/SearchResultCard.tsx:74 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/SearchResultCard.tsx:122 | a | [dynamic label] | route or new target URL |
| src/components/Sidebar.tsx:371 | SidebarMenuButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:386 | SidebarMenuButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:448 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:461 | button | setHistoryExpanded(value => !value)}> | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:461 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:587 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:594 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:607 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:631 | DropdownMenuTrigger | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:631 | button | 更多操作 | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:633 | DropdownMenuItem | setBatchMode(true)}> | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:634 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:635 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:769 | DropdownMenuTrigger | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:778 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:792 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:798 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:810 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:823 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:837 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:846 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:851 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:945 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:974 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:1086 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:1090 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:1115 | SidebarMenuButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:1153 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/StepCard.tsx:160 | a | [dynamic label] | route or new target URL |
| src/components/TaskListItem.tsx:71 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskListItem.tsx:72 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskListItem.tsx:170 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskListItem.tsx:201 | button | 任务菜单 | visible state, dialog, route or recorded local request |
| src/components/TaskListItem.tsx:245 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/TaskStream.tsx:823 | summary | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:853 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:974 | a | [dynamic label] | route or new target URL |
| src/components/TaskStream.tsx:1163 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:1171 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:1179 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:1200 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:1210 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:1226 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:1235 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:1244 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:1263 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:1628 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:1682 | summary | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:1908 | button | 重新执行任务 | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:2005 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:2147 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:2311 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:2671 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:2684 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:2695 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:2726 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:2817 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:2827 | DropdownMenuTrigger | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:2828 | button | 打开更多结果操作 | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:2843 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:2850 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:2864 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:2880 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:2913 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:3082 | a | [dynamic label] | route or new target URL |
| src/components/TaskToolbar.tsx:76 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/UpdateBanner.tsx:64 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/UpdateBanner.tsx:72 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/UserMenu.tsx:96 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/UserMenu.tsx:190 | ThemeSwitcher | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/UserMenu.tsx:245 | ThemeOption | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/UserMenu.tsx:248 | ThemeOption | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/UserMenu.tsx:251 | ThemeOption | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/UserMenu.tsx:272 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/UserMenu.tsx:305 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/astrology/AstroTaskCompanion.tsx:128 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/astrology/AstroTaskCompanion.tsx:155 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/billing/PaymentLedgerSection.tsx:186 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/billing/PaymentLedgerSection.tsx:272 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/billing/PaymentLedgerSection.tsx:320 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/billing/PaymentLedgerSection.tsx:331 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/billing/PaymentLedgerSection.tsx:394 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/billing/PaymentLedgerSection.tsx:405 | a | [dynamic label] | route or new target URL |
| src/components/energy/AstrologyDimensionGrid.tsx:73 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/AstrologyDimensionGrid.tsx:95 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/AstrologyPortalRow.tsx:53 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/AstrologyWorld.tsx:113 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/AstrologyWorld.tsx:131 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/AstrologyWorld.tsx:138 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/AstrologyWorld.tsx:162 | button | 刷新当前星座范围 | visible state, dialog, route or recorded local request |
| src/components/energy/AstrologyWorld.tsx:256 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/AstrologyWorld.tsx:276 | a | [dynamic label] | route or new target URL |
| src/components/energy/EnergyAstrologyPanel.tsx:24 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/EnergyAstrologyPanel.tsx:28 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/EnergyAstrologyPanel.tsx:36 | button | 刷新星座能量 | visible state, dialog, route or recorded local request |
| src/components/energy/EnergyContinueCard.tsx:24 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/EnergyContinueCard.tsx:32 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/EnergyContinueCard.tsx:43 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/EnergyExperienceDeck.tsx:64 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/EnergyExploreFeed.tsx:184 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/EnergyExploreFeed.tsx:238 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/EnergyExploreFeed.tsx:247 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/EnergyExploreFeed.tsx:251 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/EnergyExploreFeed.tsx:261 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/EnergyExploreFeed.tsx:273 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/EnergyHero.tsx:90 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/EnergyHero.tsx:99 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/EnergyHero.tsx:127 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/EnergyHero.tsx:150 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/EnergyMagazineCard.tsx:81 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/EnergyMagazineCard.tsx:101 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/EnergyProfileDrawer.tsx:85 | Button | 关闭个人资料 | visible state, dialog, route or recorded local request |
| src/components/energy/EnergyProfileDrawer.tsx:104 | input | 生日 | value/state changes; submit persists to local seed |
| src/components/energy/EnergyProfileDrawer.tsx:117 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/EnergyProfileDrawer.tsx:131 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/energy/EnergyProfileDrawer.tsx:142 | input | 例如：Tokyo | value/state changes; submit persists to local seed |
| src/components/energy/EnergyProfileDrawer.tsx:157 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/EnergyProfileDrawer.tsx:164 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/EnergyProfileDrawer.tsx:180 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/EnergyProfileDrawer.tsx:183 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/EnergySectionNav.tsx:56 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/EnergyShelf.tsx:42 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/EnergyShelf.tsx:56 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/EnergyShelf.tsx:151 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/EnergyShelf.tsx:172 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/EnergyShelf.tsx:207 | a | [dynamic label] | route or new target URL |
| src/components/energy/ExperiencePlayer.tsx:100 | Button | 关闭体验 | visible state, dialog, route or recorded local request |
| src/components/energy/ExperiencePlayer.tsx:118 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/ExperiencePlayer.tsx:138 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/ExperiencePlayer.tsx:141 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/MoodCheckIn.tsx:28 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/RunningTaskDock.tsx:86 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/HoroscopeExperience.tsx:81 | button | 更新星座提示 | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/HoroscopeExperience.tsx:96 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/HoroscopeExperience.tsx:99 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/HoroscopeExperience.tsx:153 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/MiniGameExperience.tsx:66 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/PollExperience.tsx:56 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/PollExperience.tsx:89 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/energy/experiences/PracticeExperience.tsx:80 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/PracticeExperience.tsx:90 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/PracticeExperience.tsx:98 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/RechargeExperience.tsx:72 | Button | onPhaseChange('active')}>开始30秒 | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/RechargeExperience.tsx:104 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/RechargeExperience.tsx:107 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/TarotExperience.tsx:190 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/TarotExperience.tsx:225 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/TarotExperience.tsx:241 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/TarotExperience.tsx:267 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/TarotExperience.tsx:297 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/TarotExperience.tsx:330 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/TarotExperience.tsx:341 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/TarotExperience.tsx:353 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/TarotExperience.tsx:364 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/TarotExperience.tsx:379 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/TestExperience.tsx:158 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/TestExperience.tsx:206 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/TestExperience.tsx:209 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/TestExperience.tsx:216 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/TestExperience.tsx:219 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/TestExperience.tsx:230 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/TestExperience.tsx:269 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/TestExperience.tsx:282 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/games/BreathRhythmGame.tsx:36 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/games/CatchEnergyGame.tsx:30 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/games/ColorMemoryGame.tsx:101 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/games/ColorMemoryGame.tsx:110 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/games/ColorMemoryGame.tsx:123 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/image/ImageBriefComposer.tsx:88 | button | 移除主角图 | visible state, dialog, route or recorded local request |
| src/components/image/ImageBriefComposer.tsx:101 | button | 更换主角图 | visible state, dialog, route or recorded local request |
| src/components/image/ImageBriefComposer.tsx:122 | button | 更换主角图 | visible state, dialog, route or recorded local request |
| src/components/image/ImageBriefComposer.tsx:135 | button | 添加主角图 | visible state, dialog, route or recorded local request |
| src/components/image/ImageBriefComposer.tsx:163 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/image/ImageBriefComposer.tsx:195 | button | 添加参考资料 | visible state, dialog, route or recorded local request |
| src/components/image/ImageBriefComposer.tsx:202 | Textarea | 描述你想要的最终画面 | value/state changes; submit persists to local seed |
| src/components/image/ImageBriefComposer.tsx:224 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/image/ImageGenerationSettings.tsx:41 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/image/ImageGenerationSettings.tsx:83 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/image/ImageGenerationSettings.tsx:117 | ChoiceButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/image/ImageGenerationSettings.tsx:130 | ChoiceButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/image/ImageGenerationSettings.tsx:167 | button | 关闭生成设置 | visible state, dialog, route or recorded local request |
| src/components/image/ImageGenerationSettings.tsx:206 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/image/ImageGoalPicker.tsx:7 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/image/ImageGoalPicker.tsx:9 | button | onCommercialUseChange(use.id)}> | visible state, dialog, route or recorded local request |
| src/components/image/ImageHistory.tsx:170 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/image/ImageHistory.tsx:196 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/image/ImageHistory.tsx:211 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/image/ImageHistory.tsx:242 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/image/ImageResultPanel.tsx:165 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/image/ImageResultPanel.tsx:174 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/image/ImageResultPanel.tsx:201 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/image/ImageResultPanel.tsx:211 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/notifications/AddChannelModal.tsx:201 | button | 关闭 | visible state, dialog, route or recorded local request |
| src/components/notifications/AddChannelModal.tsx:222 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/notifications/AddChannelModal.tsx:259 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/notifications/AddChannelModal.tsx:282 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/notifications/AddChannelModal.tsx:314 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/notifications/AddChannelModal.tsx:323 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/notifications/NotificationBell.tsx:244 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/notifications/NotificationBell.tsx:292 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/notifications/NotificationBell.tsx:338 | NotificationItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/notifications/NotificationBell.tsx:346 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/notifications/NotificationBell.tsx:406 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/notifications/NotificationBell.tsx:436 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/notifications/NotificationBell.tsx:479 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/notifications/NotificationBell.tsx:588 | button | 关闭 | visible state, dialog, route or recorded local request |
| src/components/notifications/NotificationBell.tsx:610 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/notifications/NotificationBell.tsx:620 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/notifications/NotificationsSection.tsx:60 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/notifications/NotificationsSection.tsx:284 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/notifications/NotificationsSection.tsx:304 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/notifications/NotificationsSection.tsx:359 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/notifications/NotificationsSection.tsx:372 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/OrganizationInviteDialog.tsx:149 | button | 关闭邀请对话框 | visible state, dialog, route or recorded local request |
| src/components/projects/OrganizationInviteDialog.tsx:173 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/projects/OrganizationInviteDialog.tsx:184 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/OrganizationInviteDialog.tsx:187 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/OrganizationInviteDialog.tsx:202 | select | 成员角色 | value/state changes; submit persists to local seed |
| src/components/projects/OrganizationInviteDialog.tsx:218 | select | 直属上级（可选） | value/state changes; submit persists to local seed |
| src/components/projects/OrganizationInviteDialog.tsx:239 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/OrganizationInviteDialog.tsx:242 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/OrganizationMembersPanel.tsx:107 | Button | 刷新团队成员 | visible state, dialog, route or recorded local request |
| src/components/projects/OrganizationMembersPanel.tsx:168 | select | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/projects/OrganizationMembersPanel.tsx:191 | select | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/projects/OrganizationMembersPanel.tsx:212 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/OrganizationMembersPanel.tsx:251 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/PersonalProjectDetail.tsx:79 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/PersonalProjectDetail.tsx:83 | PageHeader | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/PersonalProjectDetail.tsx:107 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/PersonalProjectDetail.tsx:120 | input | 搜索项目任务 | value/state changes; submit persists to local seed |
| src/components/projects/PersonalProjectDetail.tsx:131 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/PersonalProjectDetail.tsx:137 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/PersonalProjectDetail.tsx:156 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:264 | TaskTabs | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:267 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:267 | input | 搜索项目任务 | value/state changes; submit persists to local seed |
| src/components/projects/TeamTaskWorkbench.tsx:268 | summary | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:268 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:268 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:289 | summary | 项目进展与权限 | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:326 | button | onSelect(row.id)}> | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:371 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:410 | button | 列表视图 | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:423 | button | 看板视图 | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:438 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:460 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:537 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:617 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:740 | button | 关闭任务详情 | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:841 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:858 | Field | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:859 | Field | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:862 | input | 复核时间 | value/state changes; submit persists to local seed |
| src/components/projects/TeamTaskWorkbench.tsx:871 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/projects/TeamTaskWorkbench.tsx:878 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:900 | Field | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:901 | Field | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:902 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:918 | Field | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:919 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:932 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:941 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:954 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:961 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:968 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:975 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:993 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1135 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1144 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1165 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/projects/TeamTaskWorkbench.tsx:1181 | Field | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1182 | Field | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1185 | input | 新截止时间 | value/state changes; submit persists to local seed |
| src/components/projects/TeamTaskWorkbench.tsx:1194 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1203 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1227 | textarea | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/projects/TeamTaskWorkbench.tsx:1348 | button | 关闭新建任务 | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1360 | Field | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1371 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1389 | MemberSelect | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1402 | MultiMemberSelect | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1411 | select | 里程碑 | value/state changes; submit persists to local seed |
| src/components/projects/TeamTaskWorkbench.tsx:1427 | select | 依赖任务 | value/state changes; submit persists to local seed |
| src/components/projects/TeamTaskWorkbench.tsx:1449 | input | 截止时间 | value/state changes; submit persists to local seed |
| src/components/projects/TeamTaskWorkbench.tsx:1468 | Field | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1469 | Field | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1472 | textarea | 验收标准 1 | value/state changes; submit persists to local seed |
| src/components/projects/TeamTaskWorkbench.tsx:1486 | Field | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1492 | MemberSelect | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1498 | MemberSelect | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1517 | input | 我已复核验收契约 | value/state changes; submit persists to local seed |
| src/components/projects/TeamTaskWorkbench.tsx:1533 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1561 | select | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/projects/TeamTaskWorkbench.tsx:1592 | select | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/projects/TeamTaskWorkbench.tsx:1637 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/WorkspaceSwitcher.tsx:42 | DropdownMenuTrigger | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/WorkspaceSwitcher.tsx:42 | button | 切换工作区 | visible state, dialog, route or recorded local request |
| src/components/projects/WorkspaceSwitcher.tsx:43 | DropdownMenuItem | onSelectOrganization(null)}> | visible state, dialog, route or recorded local request |
| src/components/projects/WorkspaceSwitcher.tsx:44 | DropdownMenuItem | onSelectOrganization(organization.organizationId)}> | visible state, dialog, route or recorded local request |
| src/components/projects/WorkspaceSwitcher.tsx:47 | Button | 刷新团队空间 | visible state, dialog, route or recorded local request |
| src/components/projects/WorkspaceSwitcher.tsx:59 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/WorkspaceSwitcher.tsx:78 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/settings/AccountClosureSection.tsx:135 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/settings/AccountClosureSection.tsx:178 | button | 关闭账号向导 | visible state, dialog, route or recorded local request |
| src/components/settings/AccountClosureSection.tsx:193 | AcknowledgementStep | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/settings/AccountClosureSection.tsx:212 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/settings/AccountClosureSection.tsx:228 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/settings/AccountClosureSection.tsx:232 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/settings/AccountClosureSection.tsx:236 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/settings/AccountClosureSection.tsx:322 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/settings/AccountClosureSection.tsx:362 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/settings/AccountClosureSection.tsx:368 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/settings/AccountClosureSection.tsx:380 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/settings/BrowserDataSection.tsx:92 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/settings/BrowserDataSection.tsx:110 | select | 已选站点 | value/state changes; submit persists to local seed |
| src/components/settings/BrowserDataSection.tsx:133 | input | localStorage 字段（选填） | value/state changes; submit persists to local seed |
| src/components/settings/BrowserDataSection.tsx:144 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/settings/BrowserDataSection.tsx:158 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/settings/BrowserDataSection.tsx:166 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/settings/BrowserDataSection.tsx:232 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/settings/BrowserDataSection.tsx:247 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/settings/MemorySection.tsx:204 | input | 搜索 AI 记忆 | value/state changes; submit persists to local seed |
| src/components/settings/MemorySection.tsx:217 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/settings/MemorySection.tsx:246 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/settings/MemorySection.tsx:290 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/settings/MemorySection.tsx:325 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/settings/MemorySection.tsx:357 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/settings/ModelDataRegionSection.tsx:59 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/skills/ApprovedSkillsCatalog.tsx:42 | input | 搜索技能 | value/state changes; submit persists to local seed |
| src/components/skills/ApprovedSkillsCatalog.tsx:52 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/skills/ApprovedSkillsCatalog.tsx:60 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/skills/ApprovedSkillsCatalog.tsx:84 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/skills/ApprovedSkillsCatalog.tsx:100 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/skills/ApprovedSkillsCatalog.tsx:123 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/skills/ApprovedSkillsCatalog.tsx:164 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/skills/ApprovedSkillsCatalog.tsx:181 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/skills/ApprovedSkillsCatalog.tsx:214 | summary | 使用说明 | visible state, dialog, route or recorded local request |
| src/components/skills/ApprovedSkillsCatalog.tsx:218 | textarea | 这次任务的要求 | value/state changes; submit persists to local seed |
| src/components/skills/ApprovedSkillsCatalog.tsx:236 | input | 技能任务资料 | value/state changes; submit persists to local seed |
| src/components/skills/ApprovedSkillsCatalog.tsx:247 | button | 添加资料 | visible state, dialog, route or recorded local request |
| src/components/skills/ApprovedSkillsCatalog.tsx:259 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/skills/CapabilityCenterContent.tsx:204 | a | [dynamic label] | route or new target URL |
| src/components/skills/CapabilityCenterContent.tsx:228 | button | 移除已选任务 | visible state, dialog, route or recorded local request |
| src/components/skills/CapabilityCenterContent.tsx:279 | textarea | 描述想完成的任务 | value/state changes; submit persists to local seed |
| src/components/skills/CapabilityCenterContent.tsx:292 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/skills/CapabilityCenterContent.tsx:338 | button | 添加附件 | visible state, dialog, route or recorded local request |
| src/components/skills/CapabilityCenterContent.tsx:354 | DropdownMenuTrigger | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/skills/CapabilityCenterContent.tsx:355 | button | 选择任务使用的技能 | visible state, dialog, route or recorded local request |
| src/components/skills/CapabilityCenterContent.tsx:392 | input | 搜索技能 | value/state changes; submit persists to local seed |
| src/components/skills/CapabilityCenterContent.tsx:403 | DropdownMenuItem | 自动匹配 | visible state, dialog, route or recorded local request |
| src/components/skills/CapabilityCenterContent.tsx:424 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/skills/CapabilityCenterContent.tsx:453 | input | 选择任务附件 | value/state changes; submit persists to local seed |
| src/components/skills/CapabilityCenterContent.tsx:507 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/skills/CapabilityCenterContent.tsx:535 | button | 执行预览 | visible state, dialog, route or recorded local request |
| src/components/skills/CapabilityCenterContent.tsx:595 | button | 选择这个任务示例 | visible state, dialog, route or recorded local request |
| src/components/skills/CapabilityCenterContent.tsx:635 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/skills/CapabilityCenterContent.tsx:689 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/skills/CapabilityCenterContent.tsx:707 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/ApprovedStockComposer.tsx:128 | ResearchMenu | 选择研究范围 | visible state, dialog, route or recorded local request |
| src/components/stocks/ApprovedStockComposer.tsx:143 | DropdownMenuItem | 管理关注股票 | visible state, dialog, route or recorded local request |
| src/components/stocks/ApprovedStockComposer.tsx:147 | ResearchMenu | 选择时间范围 | visible state, dialog, route or recorded local request |
| src/components/stocks/ApprovedStockComposer.tsx:157 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/ApprovedStockComposer.tsx:182 | button | 选择参考资料 | visible state, dialog, route or recorded local request |
| src/components/stocks/ApprovedStockComposer.tsx:201 | button | 移除参考资料 | visible state, dialog, route or recorded local request |
| src/components/stocks/ApprovedStockComposer.tsx:218 | textarea | 交代股市研究任务 | value/state changes; submit persists to local seed |
| src/components/stocks/ApprovedStockComposer.tsx:238 | button | 添加本地资料 | visible state, dialog, route or recorded local request |
| src/components/stocks/ApprovedStockComposer.tsx:248 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/ApprovedStockComposer.tsx:261 | ResearchMenu | 选择输出内容 | visible state, dialog, route or recorded local request |
| src/components/stocks/ApprovedStockComposer.tsx:273 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/ApprovedStockComposer.tsx:282 | button | 提交股市任务 | visible state, dialog, route or recorded local request |
| src/components/stocks/ApprovedStockComposer.tsx:295 | summary | 研究建议 | visible state, dialog, route or recorded local request |
| src/components/stocks/ApprovedStockComposer.tsx:298 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/ApprovedStockComposer.tsx:312 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/stocks/ApprovedStockComposer.tsx:354 | DropdownMenuTrigger | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/ApprovedStockComposer.tsx:355 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/ApprovedStockComposer.tsx:363 | DropdownMenuRadioGroup | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockAiCommandComposer.tsx:75 | ApprovedStockComposer | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockAiCommandComposer.tsx:100 | button | 管理研究范围 | visible state, dialog, route or recorded local request |
| src/components/stocks/StockAiCommandComposer.tsx:100 | button | setCollapsed(current => !current)}> | visible state, dialog, route or recorded local request |
| src/components/stocks/StockAiCommandComposer.tsx:110 | textarea | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/stocks/StockAiCommandComposer.tsx:110 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/stocks/StockAiCommandComposer.tsx:111 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockAiCommandComposer.tsx:112 | button | 提交股市任务 | visible state, dialog, route or recorded local request |
| src/components/stocks/StockAiCommandComposer.tsx:135 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockPreferenceProfile.tsx:190 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockPreferenceProfile.tsx:201 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockPreferenceProfile.tsx:213 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockPreferenceProfile.tsx:309 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockPreferenceProfile.tsx:331 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockPreferenceProfile.tsx:360 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockPreferenceProfile.tsx:486 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockPreferenceProfile.tsx:637 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/stocks/StockPreferenceProfile.tsx:673 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockPreferenceProfile.tsx:683 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockPreferenceProfile.tsx:696 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockPreferenceProfile.tsx:704 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockRiskMonitorSheet.tsx:82 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockRiskMonitorSheet.tsx:90 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockRiskRadar.tsx:323 | button | 刷新风险雷达 | visible state, dialog, route or recorded local request |
| src/components/stocks/StockRiskRadar.tsx:549 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockRiskRadar.tsx:571 | a | [dynamic label] | route or new target URL |
| src/components/stocks/StockRiskRadar.tsx:589 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockRiskRadar.tsx:678 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockRiskRadar.tsx:707 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockRiskRadar.tsx:719 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockRiskRadar.tsx:730 | a | [dynamic label] | route or new target URL |
| src/components/stocks/StockScreeningWorkbench.tsx:184 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/stocks/StockScreeningWorkbench.tsx:190 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockScreeningWorkbench.tsx:201 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockScreeningWorkbench.tsx:222 | button | 清空筛选条件 | visible state, dialog, route or recorded local request |
| src/components/stocks/StockScreeningWorkbench.tsx:235 | CriterionEditor | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockScreeningWorkbench.tsx:264 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockScreeningWorkbench.tsx:408 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/stocks/StockScreeningWorkbench.tsx:425 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/stocks/StockScreeningWorkbench.tsx:507 | summary | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockScreeningWorkbench.tsx:554 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockScreeningWorkbench.tsx:592 | summary | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockWorkbenchLayout.tsx:109 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockWorkbenchLayout.tsx:214 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockWorkbenchLayout.tsx:284 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ui/dropdown-menu.tsx:35 | DropdownMenuPrimitive.SubTrigger | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ui/input.tsx:6 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/ui/sidebar.tsx:265 | Button | 切换侧边栏 | visible state, dialog, route or recorded local request |
| src/components/ui/sidebar.tsx:290 | button | 切换侧边栏 | visible state, dialog, route or recorded local request |
| src/components/ui/sidebar.tsx:332 | Input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/ui/textarea.tsx:9 | textarea | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/ui/toast.tsx:57 | button | 关闭提示 | visible state, dialog, route or recorded local request |
| src/components/video/PetMotionForm.tsx:72 | input | 宠物照片 | value/state changes; submit persists to local seed |
| src/components/video/PetMotionForm.tsx:87 | textarea | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/video/PetMotionForm.tsx:95 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/video/VideoCreationScenarioPicker.tsx:26 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/features/video-editing/SceneStrip.tsx:47 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/features/video-editing/VersionHistory.tsx:60 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/features/video-editing/VersionHistory.tsx:77 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/features/video-editing/VersionHistory.tsx:90 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/features/video-editing/VideoEditingPanel.tsx:600 | button | 返回视频页 | visible state, dialog, route or recorded local request |
| src/features/video-editing/VideoEditingPanel.tsx:639 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/features/video-editing/VideoEditingPanel.tsx:660 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/features/video-editing/VideoEditingPanel.tsx:670 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/features/video-editing/VideoEditingPanel.tsx:774 | textarea | 告诉 AI 想怎么剪 | value/state changes; submit persists to local seed |
| src/features/video-editing/VideoEditingPanel.tsx:787 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/features/video-editing/VideoEditingPanel.tsx:799 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/features/video-editing/VideoEditingPanel.tsx:837 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/features/video-editing/VideoEditingPanel.tsx:866 | button | 查看版本说明 | visible state, dialog, route or recorded local request |
| src/pages/AccountClosureRecoveryPage.tsx:102 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/AccountClosureRecoveryPage.tsx:135 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/AccountClosureRecoveryPage.tsx:138 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/AccountClosureRecoveryPage.tsx:191 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/AccountClosureRecoveryPage.tsx:203 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/AccountClosureRecoveryPage.tsx:223 | a | [dynamic label] | route or new target URL |
| src/pages/AccountClosureRecoveryPage.tsx:328 | button | 关闭撤回验证 | visible state, dialog, route or recorded local request |
| src/pages/AccountClosureRecoveryPage.tsx:347 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/AccountClosureRecoveryPage.tsx:356 | LabeledInput | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/AccountClosureRecoveryPage.tsx:363 | LabeledInput | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/AccountClosureRecoveryPage.tsx:377 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/AccountClosureRecoveryPage.tsx:380 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/AccountClosureRecoveryPage.tsx:461 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/BatchPage.tsx:192 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/BatchPage.tsx:208 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/BatchPage.tsx:275 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/BatchPage.tsx:325 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/BatchPage.tsx:487 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/BatchPage.tsx:560 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/BatchPage.tsx:577 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/BatchPage.tsx:644 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/BatchPage.tsx:713 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/BatchPage.tsx:723 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/BatchPage.tsx:730 | a | [dynamic label] | route or new target URL |
| src/pages/BatchPage.tsx:765 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/BatchPage.tsx:768 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/BatchPage.tsx:775 | a | [dynamic label] | route or new target URL |
| src/pages/BillingPage.tsx:170 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/BillingPage.tsx:173 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/BillingPage.tsx:179 | a | [dynamic label] | route or new target URL |
| src/pages/BillingPage.tsx:201 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/BillingPage.tsx:225 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/BillingPage.tsx:231 | a | [dynamic label] | route or new target URL |
| src/pages/BillingPage.tsx:242 | a | [dynamic label] | route or new target URL |
| src/pages/BillingPage.tsx:271 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/BillingPage.tsx:277 | a | [dynamic label] | route or new target URL |
| src/pages/ConnectionsPage.tsx:140 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ConnectionsPage.tsx:143 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ConnectionsPage.tsx:144 | a | [dynamic label] | route or new target URL |
| src/pages/ConnectionsPage.tsx:162 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ConnectionsPage.tsx:163 | a | [dynamic label] | route or new target URL |
| src/pages/ConnectionsPage.tsx:251 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ConnectionsPage.tsx:257 | a | [dynamic label] | route or new target URL |
| src/pages/FilesPage.tsx:345 | input | 搜索文件名 | value/state changes; submit persists to local seed |
| src/pages/FilesPage.tsx:350 | FilterTab | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:351 | FilterTab | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:356 | FilterTab | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:361 | FilterTab | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:369 | DropdownMenuTrigger | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:369 | button | 文件排序 | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:371 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:372 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:377 | button | 网格视图 | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:378 | button | 列表视图 | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:381 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:409 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:434 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:482 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:488 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:552 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:605 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:642 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:661 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:678 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:695 | DropdownMenuTrigger | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:696 | button | 更多操作 | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:707 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:711 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:715 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:719 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/HistoryPage.tsx:293 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/HistoryPage.tsx:305 | input | 搜索任务内容 | value/state changes; submit persists to local seed |
| src/pages/HistoryPage.tsx:331 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/HistoryPage.tsx:340 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/HistoryPage.tsx:346 | a | [dynamic label] | route or new target URL |
| src/pages/HistoryPage.tsx:366 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/HistoryPage.tsx:391 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/HistoryPage.tsx:431 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/HistoryPage.tsx:445 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/HistoryPage.tsx:474 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ImagePage.tsx:418 | ImageGoalPicker | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ImagePage.tsx:429 | input | 添加图片 | value/state changes; submit persists to local seed |
| src/pages/ImagePage.tsx:440 | button | 选择图片模型 | visible state, dialog, route or recorded local request |
| src/pages/ImagePage.tsx:440 | button | 生成设置 | visible state, dialog, route or recorded local request |
| src/pages/ImagePage.tsx:440 | button | 添加参考资料 | visible state, dialog, route or recorded local request |
| src/pages/ImagePage.tsx:449 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/NotFoundPage.tsx:17 | Button | 返回首页 | visible state, dialog, route or recorded local request |
| src/pages/NotFoundPage.tsx:19 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/OrganizationInvitationAcceptPage.tsx:125 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PartnerPage.tsx:211 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PartnerPage.tsx:487 | StatusPanel | 刷新失败，正在显示上次账本 | visible state, dialog, route or recorded local request |
| src/pages/PartnerPage.tsx:506 | StatusPanel | 合伙人账本暂时无法加载 | visible state, dialog, route or recorded local request |
| src/pages/PartnerPage.tsx:734 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PartnerPage.tsx:780 | Input | bank_fp_... | value/state changes; submit persists to local seed |
| src/pages/PartnerPage.tsx:790 | Input | bankcard-flow-... | value/state changes; submit persists to local seed |
| src/pages/PartnerPage.tsx:800 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PartnerPage.tsx:830 | Input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/PartnerPage.tsx:831 | Button | 复制我的邀请码 | visible state, dialog, route or recorded local request |
| src/pages/PartnerPage.tsx:848 | Input | usr_... | value/state changes; submit persists to local seed |
| src/pages/PartnerPage.tsx:859 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/PartnerPage.tsx:868 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PartnerPage.tsx:945 | PartnerPaymentProviderSelect | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PartnerPage.tsx:952 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PartnerPage.tsx:985 | Input | 例如 5000 | value/state changes; submit persists to local seed |
| src/pages/PartnerPage.tsx:997 | Input | bank_fp_... | value/state changes; submit persists to local seed |
| src/pages/PartnerPage.tsx:1008 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PartnerPage.tsx:1037 | Input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/PartnerPage.tsx:1052 | PartnerPaymentProviderSelect | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PartnerPage.tsx:1063 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/PartnerPage.tsx:1084 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PartnerPage.tsx:1095 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PartnerPage.tsx:1136 | select | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/PartnerPage.tsx:1211 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PlanPage.tsx:190 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PlanPage.tsx:202 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PlanPage.tsx:382 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PlanPage.tsx:392 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PlanPage.tsx:396 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PlanPage.tsx:401 | a | [dynamic label] | route or new target URL |
| src/pages/PlanPage.tsx:416 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PlanPage.tsx:434 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PlanPage.tsx:473 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PlanPage.tsx:568 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PlanPage.tsx:582 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PlanPage.tsx:610 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PlanPage.tsx:637 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PlanPage.tsx:643 | a | [dynamic label] | route or new target URL |
| src/pages/PrivacyPage.tsx:298 | a | [dynamic label] | route or new target URL |
| src/pages/PrivacyPage.tsx:480 | a | [dynamic label] | route or new target URL |
| src/pages/PrivacyPage.tsx:521 | a | [dynamic label] | route or new target URL |
| src/pages/PrivacyPage.tsx:530 | a | [dynamic label] | route or new target URL |
| src/pages/ProfilePage.tsx:272 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProfilePage.tsx:275 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProfilePage.tsx:281 | a | [dynamic label] | route or new target URL |
| src/pages/ProfilePage.tsx:330 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/ProfilePage.tsx:339 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/ProfilePage.tsx:349 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProfilePage.tsx:355 | a | [dynamic label] | route or new target URL |
| src/pages/ProfilePage.tsx:373 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProfilePage.tsx:399 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProfilePage.tsx:444 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/ProfilePage.tsx:456 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProfilePage.tsx:473 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/ProfilePage.tsx:487 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/ProfilePage.tsx:509 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProfilePage.tsx:524 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProfilePage.tsx:539 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProfilePage.tsx:572 | summary | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProfilePage.tsx:584 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/ProfilePage.tsx:598 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProfilePage.tsx:606 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProfilePage.tsx:625 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/ProfilePage.tsx:636 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProfilePage.tsx:645 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProfilePage.tsx:668 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProfilePage.tsx:689 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:759 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:770 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:785 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:815 | input | 搜索项目 | value/state changes; submit persists to local seed |
| src/pages/ProjectsPage.tsx:872 | PersonalCreateForm | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:1036 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:1056 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:1073 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:1094 | button | onOpen(project)}> | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:1096 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:1120 | DropdownMenuTrigger | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:1121 | button | 更多 | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:1134 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:1139 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:1201 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/ProjectsPage.tsx:1232 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:1244 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:1290 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:1367 | button | 关闭 | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:1379 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/ProjectsPage.tsx:1394 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:1404 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/RolesPage.tsx:187 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/RolesPage.tsx:190 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/RolesPage.tsx:191 | a | [dynamic label] | route or new target URL |
| src/pages/RolesPage.tsx:238 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/RolesPage.tsx:316 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/RolesPage.tsx:324 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/RolesPage.tsx:365 | RoleCard | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/RolesPage.tsx:394 | Tag | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ScheduledPage.tsx:120 | PageHeader | 定时任务 | visible state, dialog, route or recorded local request |
| src/pages/ScheduledPage.tsx:216 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ScheduledPage.tsx:230 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ScheduledPage.tsx:291 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ServerErrorPage.tsx:17 | Button | window.location.reload()}>重试 | visible state, dialog, route or recorded local request |
| src/pages/ServerErrorPage.tsx:19 | Button | 返回首页 | visible state, dialog, route or recorded local request |
| src/pages/ServerErrorPage.tsx:24 | a | [dynamic label] | route or new target URL |
| src/pages/SettingsPage.tsx:70 | ThemeSwitcher | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/SettingsPage.tsx:198 | ThemeOption | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/SettingsPage.tsx:201 | ThemeOption | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/SettingsPage.tsx:204 | ThemeOption | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/SettingsPage.tsx:223 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/SkillsPage.tsx:257 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/SkillsPage.tsx:260 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/SkillsPage.tsx:261 | a | [dynamic label] | route or new target URL |
| src/pages/SkillsPage.tsx:285 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/SkillsPage.tsx:286 | a | [dynamic label] | route or new target URL |
| src/pages/StarredPage.tsx:177 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StarredPage.tsx:180 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StarredPage.tsx:186 | a | [dynamic label] | route or new target URL |
| src/pages/StarredPage.tsx:225 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StarredPage.tsx:246 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StarredPage.tsx:268 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StarredPage.tsx:281 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockDiscoveryPage.tsx:220 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockDiscoveryPage.tsx:237 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockDiscoveryPage.tsx:252 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockDiscoveryPage.tsx:338 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:699 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:708 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:739 | button | setWorkspaceTask('risk')}>查看风险证据 | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:739 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:742 | button | setInsightSheet(marketInsight(marketIndices, dashboardTrust.tone))}> | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:1051 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:1097 | button | 上一页动态 | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:1108 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:1124 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:1137 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:1205 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:1244 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:1414 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:1559 | Input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/StockTasksPage.tsx:1575 | select | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/StockTasksPage.tsx:1600 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:1619 | Input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/StockTasksPage.tsx:1628 | Input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/StockTasksPage.tsx:1635 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:1679 | Input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/StockTasksPage.tsx:1691 | Input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/StockTasksPage.tsx:1706 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:1714 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:2189 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:2235 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:2272 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/TeamProjectPage.tsx:558 | PageHeader | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/TeamProjectPage.tsx:686 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/TermsPage.tsx:101 | a | support@holaday.ai | route or new target URL |
| src/pages/UsagePage.tsx:87 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/UsagePage.tsx:128 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/UsagePage.tsx:138 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/UsagePage.tsx:144 | a | [dynamic label] | route or new target URL |
| src/pages/UsagePage.tsx:181 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/UsagePage.tsx:184 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/UsagePage.tsx:190 | a | [dynamic label] | route or new target URL |
| src/pages/UsagePage.tsx:298 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:960 | button | 模型与生成设置 | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:960 | button | 移除模板 | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:969 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:977 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:978 | CreativeSegment | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:979 | CreativeSegment | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1001 | button | 添加参考素材 | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1015 | Textarea | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/VideoPage.tsx:1016 | button | 添加本地资料 | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1017 | button | 添加参考图 | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1018 | button | 添加参考视频 | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1019 | button | 调整视频规格 | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1020 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1021 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/VideoPage.tsx:1033 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/VideoPage.tsx:1061 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/VideoPage.tsx:1072 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1255 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1273 | CreativeStyleDialog | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1343 | button | 关闭风格选择 | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1357 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1380 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1441 | button | 选择视频 | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1468 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1491 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1540 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1828 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1853 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1878 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1931 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1987 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2077 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2112 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2281 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2321 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2331 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2341 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2356 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2398 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2548 | Textarea | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/VideoPage.tsx:2562 | SegGroup | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2563 | SegGroup | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2564 | SegGroup | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2570 | SegGroup | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2576 | SegGroup | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2605 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2810 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/VideoPage.tsx:2811 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/VideoPage.tsx:2814 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2818 | button | 移除主角照片 | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2821 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2824 | button | 移除参考视频 | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2830 | Textarea | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/VideoPage.tsx:2832 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2833 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2835 | button | void handleSubmit()}> | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2860 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:3087 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:3107 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/VideoPage.tsx:3108 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/VideoPage.tsx:3109 | button | void load()}>重试同步 | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:3111 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:3112 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:3116 | summary | 隐私与素材管理 | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:3116 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:3189 | Textarea | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/VideoPage.tsx:3190 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:3190 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:3190 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:3193 | input | setConsent(e.target.checked)} /> | value/state changes; submit persists to local seed |
| src/pages/admin/AdminFinancePage.tsx:142 | TabButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminFinancePage.tsx:145 | TabButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminFinancePage.tsx:236 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminFinancePage.tsx:843 | input | 成本查询任务 ID | value/state changes; submit persists to local seed |
| src/pages/admin/AdminFinancePage.tsx:844 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminLearningDomainPage.tsx:277 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminLearningPage.tsx:138 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminLearningPage.tsx:146 | FilterPill | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminLearningPage.tsx:149 | FilterPill | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminLearningPage.tsx:155 | FilterPill | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminLearningPage.tsx:211 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminLearningPage.tsx:224 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminLearningPage.tsx:382 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminModelsPage.tsx:141 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminModelsPage.tsx:173 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminModelsPage.tsx:186 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminModelsPage.tsx:207 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminModelsPage.tsx:219 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminModelsPage.tsx:319 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminModelsPage.tsx:337 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminModelsPage.tsx:343 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminModelsPage.tsx:349 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminPartnerReviewPage.tsx:276 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminPartnerReviewPage.tsx:484 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminPartnerReviewPage.tsx:533 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminPartnerReviewPage.tsx:617 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminPartnerReviewPage.tsx:624 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminPartnerReviewPage.tsx:631 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminPartnerReviewPage.tsx:632 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminPartnerReviewPage.tsx:761 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminPartnerReviewPage.tsx:767 | select | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminPartnerReviewPage.tsx:777 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminPartnerReviewPage.tsx:783 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminPartnerReviewPage.tsx:789 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminPartnerReviewPage.tsx:795 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminPartnerReviewPage.tsx:801 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminPartnerReviewPage.tsx:842 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminPartnerReviewPage.tsx:867 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminPartnerReviewPage.tsx:947 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminPartnerReviewPage.tsx:960 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminPartnerReviewPage.tsx:972 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminPartnerReviewPage.tsx:1062 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminPartnerReviewPage.tsx:1088 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminPartnerReviewPage.tsx:1099 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminPartnerReviewPage.tsx:1127 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminPartnerReviewPage.tsx:1138 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminPartnerReviewPage.tsx:1221 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminPartnerReviewPage.tsx:1232 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminPartnerReviewPage.tsx:1341 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminPartnerReviewPage.tsx:1352 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminPartnerReviewPage.tsx:1390 | select | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminPartnerReviewPage.tsx:1405 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminPartnerReviewPage.tsx:1416 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminPartnerReviewPage.tsx:1630 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminSelfCheckPage.tsx:67 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminSelfCheckPage.tsx:76 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminUsersPage.tsx:121 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminUsersPage.tsx:131 | SortPill | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminUsersPage.tsx:137 | SortPill | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminUsersPage.tsx:143 | SortPill | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminUsersPage.tsx:248 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminUsersPage.tsx:262 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminUsersPage.tsx:310 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedScopeDialog.tsx:50 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedScopeDialog.tsx:53 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedScopeDialog.tsx:56 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedScopeDialog.tsx:60 | Button | 取消 | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:747 | DropdownMenuTrigger | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:748 | Button | 旧任务记录 | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:754 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:758 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:764 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:773 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:781 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:790 | input | 查找规划 | value/state changes; submit persists to local seed |
| src/pages/planned/PlannedTasksPage.tsx:822 | Button | 上一个月 | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:831 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:834 | Button | 下一个月 | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:890 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:898 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:909 | button | 添加当天安排 | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:914 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:921 | button | openCreate(selectedDay)}> | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:940 | Button | 关闭 | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:953 | Input | 名称 | value/state changes; submit persists to local seed |
| src/pages/planned/PlannedTasksPage.tsx:963 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:974 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:993 | Input | 描述这个任务 | value/state changes; submit persists to local seed |
| src/pages/planned/PlannedTasksPage.tsx:1009 | Button | 移除任务 | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:1026 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:1044 | Textarea | 任务说明 | value/state changes; submit persists to local seed |
| src/pages/planned/PlannedTasksPage.tsx:1073 | Textarea | 统一要求（可选） | value/state changes; submit persists to local seed |
| src/pages/planned/PlannedTasksPage.tsx:1085 | Input | 日期 | value/state changes; submit persists to local seed |
| src/pages/planned/PlannedTasksPage.tsx:1101 | Input | 时间 | value/state changes; submit persists to local seed |
| src/pages/planned/PlannedTasksPage.tsx:1129 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:1161 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:1195 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:1203 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:1213 | Input | 结束日期 | value/state changes; submit persists to local seed |
| src/pages/planned/PlannedTasksPage.tsx:1226 | select | 时区 | value/state changes; submit persists to local seed |
| src/pages/planned/PlannedTasksPage.tsx:1238 | select | 提前提醒 | value/state changes; submit persists to local seed |
| src/pages/planned/PlannedTasksPage.tsx:1266 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:1270 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:1278 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:1345 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:1351 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:1451 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:1460 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/scheduled-calendar/EventDetailPopover.tsx:252 | select | 失败通知阈值 | value/state changes; submit persists to local seed |
| src/pages/scheduled-calendar/EventDetailPopover.tsx:272 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/scheduled-calendar/EventDetailPopover.tsx:291 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/scheduled-calendar/EventDetailPopover.tsx:308 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/scheduled-calendar/EventDetailPopover.tsx:325 | Button | 删除定时任务 | visible state, dialog, route or recorded local request |
| src/pages/scheduled-calendar/QuickCreatePopover.tsx:234 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/scheduled-calendar/QuickCreatePopover.tsx:249 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/scheduled-calendar/QuickCreatePopover.tsx:262 | textarea | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/scheduled-calendar/QuickCreatePopover.tsx:278 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/scheduled-calendar/QuickCreatePopover.tsx:299 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/scheduled-calendar/QuickCreatePopover.tsx:322 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/scheduled-calendar/QuickCreatePopover.tsx:341 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/scheduled-calendar/QuickCreatePopover.tsx:363 | textarea | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/scheduled-calendar/QuickCreatePopover.tsx:389 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/scheduled-calendar/QuickCreatePopover.tsx:399 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/scheduled-calendar/ScheduledCalendarPage.tsx:780 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/scheduled-calendar/ScheduledCalendarPage.tsx:796 | button | 上一个 | visible state, dialog, route or recorded local request |
| src/pages/scheduled-calendar/ScheduledCalendarPage.tsx:805 | button | 下一个 | visible state, dialog, route or recorded local request |
| src/pages/scheduled-calendar/ScheduledCalendarPage.tsx:814 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/scheduled-calendar/ScheduledCalendarPage.tsx:835 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/scheduled-calendar/ScheduledCalendarPage.tsx:867 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/scheduled-calendar/ScheduledCalendarPage.tsx:877 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/scheduled-calendar/ScheduledCalendarPage.tsx:884 | a | [dynamic label] | route or new target URL |
