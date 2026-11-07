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
| /cosmic-preview | AstrologyPage | src/pages/AstrologyPage.tsx | 166 |
| /app | AppAliasRedirect | redirect / composed route | 118 |
| /roles | LegacyRolesRedirect | redirect / composed route | 118 |
| /tasks | LegacyPathRedirect | redirect / composed route | 118 |
| /schedule | LegacyPathRedirect | redirect / composed route | 118 |
| /calendar | LegacyPathRedirect | redirect / composed route | 118 |
| /experts | LegacyPathRedirect | redirect / composed route | 118 |
| /plugins | LegacyPathRedirect | redirect / composed route | 118 |
| /settings/appearance | LegacySettingsSectionRedirect | redirect / composed route | 118 |
| /settings/api-keys | LegacySettingsSectionRedirect | redirect / composed route | 118 |
| /settings/memory | LegacySettingsSectionRedirect | redirect / composed route | 118 |
| /settings/notifications | LegacySettingsSectionRedirect | redirect / composed route | 118 |
| /settings/account | LegacySettingsSectionRedirect | redirect / composed route | 118 |
| /admin | AdminDashboardPage | src/pages/admin/AdminDashboardPage.tsx | 118 |
| /admin/users | AdminUsersPage | src/pages/admin/AdminUsersPage.tsx | 125 |
| /admin/users/:userId | AdminUserDetailPage | src/pages/admin/AdminUserDetailPage.tsx | 118 |
| /admin/finance | AdminFinancePage | src/pages/admin/AdminFinancePage.tsx | 123 |
| /admin/partners | AdminPartnerReviewPage | src/pages/admin/AdminPartnerReviewPage.tsx | 150 |
| /admin/learning | AdminLearningPage | src/pages/admin/AdminLearningPage.tsx | 125 |
| /admin/models | AdminModelsPage | src/pages/admin/AdminModelsPage.tsx | 127 |
| /admin/self-check | AdminSelfCheckPage | src/pages/admin/AdminSelfCheckPage.tsx | 120 |
| /admin/learning/:domain | AdminLearningDomainPage | src/pages/admin/AdminLearningDomainPage.tsx | 119 |
| / | WorkbenchApp | src/WorkbenchApp.tsx | 267 |
| /profile | ProfilePage | src/pages/ProfilePage.tsx | 143 |
| /settings | SettingsPage | src/pages/SettingsPage.tsx | 175 |
| /settings/roles | RolesPage | src/pages/RolesPage.tsx | 126 |
| /partner | PartnerPage | src/pages/PartnerPage.tsx | 142 |
| /partner/recharge | PartnerWorkbenchSectionRedirect | redirect / composed route | 118 |
| /partner/ledger | PartnerWorkbenchSectionRedirect | redirect / composed route | 118 |
| /partner/withdraw | PartnerWorkbenchSectionRedirect | redirect / composed route | 118 |
| /plan | PlanPage | src/pages/PlanPage.tsx | 135 |
| /billing | BillingPage | src/pages/BillingPage.tsx | 133 |
| /usage | UsagePage | src/pages/UsagePage.tsx | 126 |
| /cosmic | AstrologyPage | src/pages/AstrologyPage.tsx | 166 |
| /history | HistoryPage | src/pages/HistoryPage.tsx | 128 |
| /skills | SkillsPage | src/pages/SkillsPage.tsx | 155 |
| /stocks | StockTasksPage | src/pages/StockTasksPage.tsx | 221 |
| /stocks/discovery | StockDiscoveryPage | src/pages/StockDiscoveryPage.tsx | 129 |
| /projects | ProjectsPage | src/pages/ProjectsPage.tsx | 167 |
| /projects/:projectId | TeamProjectPage | src/pages/TeamProjectPage.tsx | 182 |
| /organizations/invitations/accept | OrganizationInvitationAcceptPage | src/pages/OrganizationInvitationAcceptPage.tsx | 119 |
| /starred | StarredPage | src/pages/StarredPage.tsx | 125 |
| /files | FilesPage | src/pages/FilesPage.tsx | 151 |
| /video | VideoGate | redirect / composed route | 118 |
| /video/edit/:projectId | VideoEditingRoute | redirect / composed route | 118 |
| /image | ImagePage | src/pages/ImagePage.tsx | 168 |
| /planned | PlannedTasksPage | src/pages/planned/PlannedTasksPage.tsx | 164 |
| /planned/legacy-scheduled | ScheduledPage | src/pages/ScheduledPage.tsx | 135 |
| /planned/legacy-batch | BatchPage | src/pages/BatchPage.tsx | 145 |
| /scheduled | LegacyPathRedirect | redirect / composed route | 118 |
| /batch | LegacyPathRedirect | redirect / composed route | 118 |
| /batch/:batchId | BatchPage | src/pages/BatchPage.tsx | 145 |
| /connections | ConnectionsPage | src/pages/ConnectionsPage.tsx | 125 |
| * | NotFoundPage | src/pages/NotFoundPage.tsx | 120 |

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

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/AstrologyDimensionGrid.tsx:73 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/AstrologyDimensionGrid.tsx:104 — [dynamic label] — visible state, dialog, route or recorded local request
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
- src/components/energy/ExperiencePlayer.tsx:106 — 关闭体验 — visible state, dialog, route or recorded local request
- src/components/energy/ExperiencePlayer.tsx:124 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/ExperiencePlayer.tsx:146 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/ExperiencePlayer.tsx:149 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/RunningTaskDock.tsx:86 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request

### /app

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request

### /roles

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request

### /tasks

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request

### /schedule

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request

### /calendar

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request

### /experts

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request

### /plugins

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request

### /settings/appearance

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request

### /settings/api-keys

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request

### /settings/memory

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request

### /settings/notifications

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request

### /settings/account

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request

### /admin

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request

### /admin/users

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/admin/AdminUsersPage.tsx:121 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminUsersPage.tsx:131 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminUsersPage.tsx:137 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminUsersPage.tsx:143 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminUsersPage.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminUsersPage.tsx:258 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminUsersPage.tsx:306 — [dynamic label] — visible state, dialog, route or recorded local request

### /admin/users/:userId

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request

### /admin/finance

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/admin/AdminFinancePage.tsx:143 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminFinancePage.tsx:146 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminFinancePage.tsx:242 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminFinancePage.tsx:886 — 成本查询任务 ID — value/state changes; submit persists to local seed
- src/pages/admin/AdminFinancePage.tsx:894 — [dynamic label] — visible state, dialog, route or recorded local request

### /admin/partners

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/admin/AdminPartnerReviewPage.tsx:275 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminPartnerReviewPage.tsx:522 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminPartnerReviewPage.tsx:569 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminPartnerReviewPage.tsx:655 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminPartnerReviewPage.tsx:662 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminPartnerReviewPage.tsx:669 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminPartnerReviewPage.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminPartnerReviewPage.tsx:837 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminPartnerReviewPage.tsx:843 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminPartnerReviewPage.tsx:853 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminPartnerReviewPage.tsx:859 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminPartnerReviewPage.tsx:865 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminPartnerReviewPage.tsx:871 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminPartnerReviewPage.tsx:877 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminPartnerReviewPage.tsx:935 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminPartnerReviewPage.tsx:960 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminPartnerReviewPage.tsx:1058 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminPartnerReviewPage.tsx:1071 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminPartnerReviewPage.tsx:1083 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminPartnerReviewPage.tsx:1184 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminPartnerReviewPage.tsx:1210 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminPartnerReviewPage.tsx:1221 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminPartnerReviewPage.tsx:1249 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminPartnerReviewPage.tsx:1260 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminPartnerReviewPage.tsx:1363 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminPartnerReviewPage.tsx:1374 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminPartnerReviewPage.tsx:1512 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminPartnerReviewPage.tsx:1523 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminPartnerReviewPage.tsx:1561 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminPartnerReviewPage.tsx:1577 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminPartnerReviewPage.tsx:1588 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminPartnerReviewPage.tsx:1837 — [dynamic label] — visible state, dialog, route or recorded local request

### /admin/learning

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/admin/AdminLearningPage.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/admin/AdminLearningPage.tsx:147 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminLearningPage.tsx:150 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminLearningPage.tsx:153 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminLearningPage.tsx:206 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminLearningPage.tsx:219 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminLearningPage.tsx:386 — [dynamic label] — visible state, dialog, route or recorded local request

### /admin/models

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request
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

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/admin/AdminSelfCheckPage.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/admin/AdminSelfCheckPage.tsx:76 — [dynamic label] — visible state, dialog, route or recorded local request

### /admin/learning/:domain

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/admin/AdminLearningDomainPage.tsx:264 — [dynamic label] — visible state, dialog, route or recorded local request

### /

- src/WorkbenchApp.tsx:862 — 收起浏览器 — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/AttachmentChip.tsx:120 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AttachmentChip.tsx:129 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:1392 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:1414 — 收起浏览器 — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:1484 — 退出全屏 (Esc) — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:1559 — 停止当前任务 — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:1577 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:1613 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:1806 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:1840 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:1872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:1927 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:1947 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:1969 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:1984 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:2036 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:2150 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:2163 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:2175 — 全屏查看任务截图 — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:2265 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:2327 — 收起操作日志 — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:2391 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/BrowserPanel.tsx:2482 — 中文 / 任意文本输入（先点击页面上的输入框获得焦点） — value/state changes; submit persists to local seed
- src/components/BrowserPanel.tsx:2501 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:2515 — 关闭浮动输入框 — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:2579 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:2691 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:2754 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:3077 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/BrowserPanel.tsx:3129 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:3174 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:3348 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BrowserPanel.tsx:3365 — [dynamic label] — visible state, dialog, route or recorded local request
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
- src/components/CdpScreencastViewport.tsx:986 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FailureHeaderCard.tsx:85 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FailureHeaderCard.tsx:114 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FileDownloadCard.tsx:298 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FileDownloadCard.tsx:308 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:751 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:765 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:791 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/InputArea.tsx:841 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:842 — 附件与任务选项 — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:861 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:878 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:913 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:956 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:999 — 添加图片 — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:1011 — 选择技能 — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:1027 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:1046 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:1047 — 执行模式 — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:1059 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:1068 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:1081 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/InputArea.tsx:1093 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/InputArea.tsx:1104 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:1178 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:1354 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:1481 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/InputArea.tsx:1490 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LazyLoadBoundary.tsx:110 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LazyLoadBoundary.tsx:136 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LocalChromePicker.tsx:59 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LocalChromePicker.tsx:60 — 选择 Chrome 页面 — visible state, dialog, route or recorded local request
- src/components/LocalChromePicker.tsx:116 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LocalChromePicker.tsx:132 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LocalChromePicker.tsx:147 — 移除 Chrome 页面 — visible state, dialog, route or recorded local request
- src/components/LocalChromeTaskPanel.tsx:53 — 关闭浏览器面板 — visible state, dialog, route or recorded local request
- src/components/LocalChromeTaskPanel.tsx:104 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LocalChromeTaskPanel.tsx:119 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/MainPanel.tsx:182 — 打开任务列表 — visible state, dialog, route or recorded local request
- src/components/MainPanel.tsx:387 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ModelDataRegionDialog.tsx:77 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ModelDataRegionDialog.tsx:108 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ModelDataRegionDialog.tsx:111 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/PlanCard.tsx:93 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/PlanCard.tsx:140 — [dynamic label] — route or new target URL
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/RoleNudgeBanner.tsx:84 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/RoleNudgeBanner.tsx:91 — 关闭角色引导 — visible state, dialog, route or recorded local request
- src/components/ScheduledTaskDialog.tsx:200 — 新建定时任务 — visible state, dialog, route or recorded local request
- src/components/ScheduledTaskDialog.tsx:207 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ScheduledTaskDialog.tsx:222 — 关闭 — visible state, dialog, route or recorded local request
- src/components/ScheduledTaskDialog.tsx:236 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ScheduledTaskDialog.tsx:253 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ScheduledTaskDialog.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ScheduledTaskDialog.tsx:297 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ScheduledTaskDialog.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ScheduledTaskDialog.tsx:337 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ScheduledTaskDialog.tsx:349 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ScheduledTaskDialog.tsx:364 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ScheduledTaskDialog.tsx:382 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ScheduledTaskDialog.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchResultCard.tsx:78 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchResultCard.tsx:124 — [dynamic label] — route or new target URL
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/StepCard.tsx:148 — [dynamic label] — route or new target URL
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/TaskStream.tsx:794 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:824 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:947 — [dynamic label] — route or new target URL
- src/components/TaskStream.tsx:1149 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:1157 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:1165 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:1186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:1196 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:1210 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:1219 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:1228 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:1246 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:1255 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:1306 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:1648 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:1698 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:1921 — 重新执行任务 — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:2018 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:2159 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:2318 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:2684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:2699 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:2710 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:2736 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:2828 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:2838 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:2839 — 打开更多结果操作 — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:2854 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:2861 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:2875 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:2887 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:2920 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskStream.tsx:3085 — [dynamic label] — route or new target URL
- src/components/TaskToolbar.tsx:76 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/textarea.tsx:9 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request

### /profile

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request
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
- src/components/ApiKeysSection.tsx:314 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ApiKeysSection.tsx:361 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ApiKeysSection.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ApiKeysSection.tsx:414 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ApiKeysSection.tsx:464 — 撤销 — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ModelDataRegionDialog.tsx:77 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ModelDataRegionDialog.tsx:108 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ModelDataRegionDialog.tsx:111 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/AddChannelModal.tsx:195 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/AddChannelModal.tsx:214 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/AddChannelModal.tsx:250 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/notifications/AddChannelModal.tsx:273 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/AddChannelModal.tsx:303 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/AddChannelModal.tsx:312 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationsSection.tsx:60 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/notifications/NotificationsSection.tsx:278 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationsSection.tsx:296 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationsSection.tsx:346 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationsSection.tsx:359 — [dynamic label] — visible state, dialog, route or recorded local request
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
- src/components/settings/ModelDataRegionSection.tsx:56 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/SettingsPage.tsx:70 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/SettingsPage.tsx:198 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/SettingsPage.tsx:201 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/SettingsPage.tsx:204 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/SettingsPage.tsx:223 — [dynamic label] — visible state, dialog, route or recorded local request

### /settings/roles

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/RolesPage.tsx:181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/RolesPage.tsx:184 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/RolesPage.tsx:185 — [dynamic label] — route or new target URL
- src/pages/RolesPage.tsx:232 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/RolesPage.tsx:308 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/RolesPage.tsx:311 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/RolesPage.tsx:353 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/RolesPage.tsx:382 — [dynamic label] — visible state, dialog, route or recorded local request

### /partner

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/PartnerPage.tsx:214 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PartnerPage.tsx:498 — 刷新失败，正在显示上次账本 — visible state, dialog, route or recorded local request
- src/pages/PartnerPage.tsx:522 — 合伙人账本暂时无法加载 — visible state, dialog, route or recorded local request
- src/pages/PartnerPage.tsx:777 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PartnerPage.tsx:823 — bank_fp_... — value/state changes; submit persists to local seed
- src/pages/PartnerPage.tsx:833 — bankcard-flow-... — value/state changes; submit persists to local seed
- src/pages/PartnerPage.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PartnerPage.tsx:873 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/PartnerPage.tsx:874 — 复制我的邀请码 — visible state, dialog, route or recorded local request
- src/pages/PartnerPage.tsx:891 — usr_... — value/state changes; submit persists to local seed
- src/pages/PartnerPage.tsx:902 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/PartnerPage.tsx:911 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PartnerPage.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PartnerPage.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PartnerPage.tsx:1050 — 例如 5000 — value/state changes; submit persists to local seed
- src/pages/PartnerPage.tsx:1062 — bank_fp_... — value/state changes; submit persists to local seed
- src/pages/PartnerPage.tsx:1073 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PartnerPage.tsx:1102 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/PartnerPage.tsx:1117 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PartnerPage.tsx:1128 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/PartnerPage.tsx:1151 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PartnerPage.tsx:1164 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PartnerPage.tsx:1205 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/PartnerPage.tsx:1280 — [dynamic label] — visible state, dialog, route or recorded local request

### /partner/recharge

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request

### /partner/ledger

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request

### /partner/withdraw

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request

### /plan

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/CnPaymentDialog.tsx:188 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/CnPaymentDialog.tsx:195 — 关闭 — visible state, dialog, route or recorded local request
- src/components/CnPaymentDialog.tsx:281 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/PlanPage.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PlanPage.tsx:204 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PlanPage.tsx:385 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PlanPage.tsx:395 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PlanPage.tsx:399 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PlanPage.tsx:404 — [dynamic label] — route or new target URL
- src/pages/PlanPage.tsx:419 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PlanPage.tsx:437 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PlanPage.tsx:476 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PlanPage.tsx:571 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PlanPage.tsx:585 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PlanPage.tsx:613 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PlanPage.tsx:640 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/PlanPage.tsx:646 — [dynamic label] — route or new target URL

### /billing

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/billing/PaymentLedgerSection.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/billing/PaymentLedgerSection.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/billing/PaymentLedgerSection.tsx:320 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/billing/PaymentLedgerSection.tsx:331 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/billing/PaymentLedgerSection.tsx:394 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/billing/PaymentLedgerSection.tsx:405 — [dynamic label] — route or new target URL
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request
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

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/UsagePage.tsx:87 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/UsagePage.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/UsagePage.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/UsagePage.tsx:144 — [dynamic label] — route or new target URL
- src/pages/UsagePage.tsx:181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/UsagePage.tsx:184 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/UsagePage.tsx:190 — [dynamic label] — route or new target URL
- src/pages/UsagePage.tsx:298 — [dynamic label] — visible state, dialog, route or recorded local request

### /cosmic

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/AstrologyDimensionGrid.tsx:73 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/AstrologyDimensionGrid.tsx:104 — [dynamic label] — visible state, dialog, route or recorded local request
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
- src/components/energy/ExperiencePlayer.tsx:106 — 关闭体验 — visible state, dialog, route or recorded local request
- src/components/energy/ExperiencePlayer.tsx:124 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/ExperiencePlayer.tsx:146 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/ExperiencePlayer.tsx:149 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/energy/RunningTaskDock.tsx:86 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request

### /history

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/HistoryPage.tsx:297 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/HistoryPage.tsx:309 — 搜索任务内容 — value/state changes; submit persists to local seed
- src/pages/HistoryPage.tsx:335 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/HistoryPage.tsx:344 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/HistoryPage.tsx:350 — [dynamic label] — route or new target URL
- src/pages/HistoryPage.tsx:366 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/HistoryPage.tsx:391 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/HistoryPage.tsx:431 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/HistoryPage.tsx:445 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/HistoryPage.tsx:474 — [dynamic label] — visible state, dialog, route or recorded local request

### /skills

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/AttachmentChip.tsx:120 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AttachmentChip.tsx:129 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
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
- src/components/skills/CapabilityCenterContent.tsx:198 — [dynamic label] — route or new target URL
- src/components/skills/CapabilityCenterContent.tsx:222 — 移除已选任务 — visible state, dialog, route or recorded local request
- src/components/skills/CapabilityCenterContent.tsx:273 — 描述想完成的任务 — value/state changes; submit persists to local seed
- src/components/skills/CapabilityCenterContent.tsx:286 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/skills/CapabilityCenterContent.tsx:328 — 添加附件 — visible state, dialog, route or recorded local request
- src/components/skills/CapabilityCenterContent.tsx:344 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/skills/CapabilityCenterContent.tsx:345 — 选择任务使用的技能 — visible state, dialog, route or recorded local request
- src/components/skills/CapabilityCenterContent.tsx:380 — 搜索技能 — value/state changes; submit persists to local seed
- src/components/skills/CapabilityCenterContent.tsx:391 — 自动匹配 — visible state, dialog, route or recorded local request
- src/components/skills/CapabilityCenterContent.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/skills/CapabilityCenterContent.tsx:441 — 选择任务附件 — value/state changes; submit persists to local seed
- src/components/skills/CapabilityCenterContent.tsx:498 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/skills/CapabilityCenterContent.tsx:526 — 执行预览 — visible state, dialog, route or recorded local request
- src/components/skills/CapabilityCenterContent.tsx:586 — 选择这个任务示例 — visible state, dialog, route or recorded local request
- src/components/skills/CapabilityCenterContent.tsx:626 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/skills/CapabilityCenterContent.tsx:680 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/skills/CapabilityCenterContent.tsx:698 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/SkillsPage.tsx:257 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/SkillsPage.tsx:260 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/SkillsPage.tsx:261 — [dynamic label] — route or new target URL
- src/pages/SkillsPage.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/SkillsPage.tsx:286 — [dynamic label] — route or new target URL

### /stocks

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/AttachmentChip.tsx:120 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AttachmentChip.tsx:129 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
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
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/NewsDetailModal.tsx:137 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/NewsDetailModal.tsx:147 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/NewsDetailModal.tsx:157 — 关闭 — visible state, dialog, route or recorded local request
- src/components/NewsDetailModal.tsx:250 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/NewsDetailModal.tsx:264 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/NewsDetailModal.tsx:300 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
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
- src/components/stocks/StockAiCommandComposer.tsx:77 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockAiCommandComposer.tsx:124 — 管理研究范围 — visible state, dialog, route or recorded local request
- src/components/stocks/StockAiCommandComposer.tsx:133 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockAiCommandComposer.tsx:164 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/stocks/StockAiCommandComposer.tsx:178 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/stocks/StockAiCommandComposer.tsx:189 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockAiCommandComposer.tsx:200 — 提交股市任务 — visible state, dialog, route or recorded local request
- src/components/stocks/StockAiCommandComposer.tsx:225 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockPreferenceProfile.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockPreferenceProfile.tsx:202 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockPreferenceProfile.tsx:214 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockPreferenceProfile.tsx:308 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockPreferenceProfile.tsx:330 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockPreferenceProfile.tsx:359 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockPreferenceProfile.tsx:485 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockPreferenceProfile.tsx:636 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/stocks/StockPreferenceProfile.tsx:672 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockPreferenceProfile.tsx:682 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockPreferenceProfile.tsx:695 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockPreferenceProfile.tsx:703 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockRiskMonitorSheet.tsx:85 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockRiskMonitorSheet.tsx:93 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockRiskRadar.tsx:341 — 刷新风险雷达 — visible state, dialog, route or recorded local request
- src/components/stocks/StockRiskRadar.tsx:568 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockRiskRadar.tsx:590 — [dynamic label] — route or new target URL
- src/components/stocks/StockRiskRadar.tsx:608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockRiskRadar.tsx:697 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockRiskRadar.tsx:740 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockRiskRadar.tsx:753 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockRiskRadar.tsx:768 — [dynamic label] — route or new target URL
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
- src/components/stocks/StockWorkbenchLayout.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockWorkbenchLayout.tsx:224 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/stocks/StockWorkbenchLayout.tsx:294 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:756 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:771 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:818 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:821 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:851 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:1222 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:1276 — 上一页动态 — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:1287 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:1305 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:1320 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:1387 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:1429 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:1629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:1785 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/StockTasksPage.tsx:1801 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/StockTasksPage.tsx:1829 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:1852 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/StockTasksPage.tsx:1863 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/StockTasksPage.tsx:1872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:1925 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/StockTasksPage.tsx:1937 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/StockTasksPage.tsx:1952 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:1960 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:2489 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:2541 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockTasksPage.tsx:2582 — [dynamic label] — visible state, dialog, route or recorded local request

### /stocks/discovery

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/DiscoveryNewsCard.tsx:33 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/NewsDetailModal.tsx:137 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/NewsDetailModal.tsx:147 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/NewsDetailModal.tsx:157 — 关闭 — visible state, dialog, route or recorded local request
- src/components/NewsDetailModal.tsx:250 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/NewsDetailModal.tsx:264 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/NewsDetailModal.tsx:300 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/StockDiscoveryPage.tsx:247 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockDiscoveryPage.tsx:266 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockDiscoveryPage.tsx:281 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StockDiscoveryPage.tsx:372 — [dynamic label] — visible state, dialog, route or recorded local request

### /projects

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
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
- src/components/projects/WorkspaceSwitcher.tsx:45 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/WorkspaceSwitcher.tsx:46 — 切换工作区 — visible state, dialog, route or recorded local request
- src/components/projects/WorkspaceSwitcher.tsx:56 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/WorkspaceSwitcher.tsx:61 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/WorkspaceSwitcher.tsx:74 — 刷新团队空间 — visible state, dialog, route or recorded local request
- src/components/projects/WorkspaceSwitcher.tsx:86 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/WorkspaceSwitcher.tsx:105 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:763 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:774 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:789 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:821 — 搜索项目 — value/state changes; submit persists to local seed
- src/pages/ProjectsPage.tsx:890 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:1058 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:1078 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:1095 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:1121 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:1147 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:1171 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:1172 — 更多 — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:1185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:1190 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:1256 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/ProjectsPage.tsx:1287 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:1299 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:1345 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:1422 — 关闭 — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:1434 — [dynamic label] — value/state changes; submit persists to local seed
- src/pages/ProjectsPage.tsx:1449 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ProjectsPage.tsx:1459 — [dynamic label] — visible state, dialog, route or recorded local request

### /projects/:projectId

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:289 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:302 — 搜索项目任务 — value/state changes; submit persists to local seed
- src/components/projects/TeamTaskWorkbench.tsx:314 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:320 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:335 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:383 — 项目进展与权限 — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:433 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:544 — 列表视图 — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:557 — 看板视图 — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:572 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:594 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:671 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:751 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:879 — 关闭任务详情 — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:980 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:997 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:998 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1001 — 复核时间 — value/state changes; submit persists to local seed
- src/components/projects/TeamTaskWorkbench.tsx:1010 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/projects/TeamTaskWorkbench.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1039 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1040 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1041 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1057 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1058 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1071 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1080 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1093 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1100 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1114 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1132 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1274 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1283 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1304 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/projects/TeamTaskWorkbench.tsx:1320 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1321 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1324 — 新截止时间 — value/state changes; submit persists to local seed
- src/components/projects/TeamTaskWorkbench.tsx:1333 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1342 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1366 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/projects/TeamTaskWorkbench.tsx:1487 — 关闭新建任务 — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1499 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1510 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1528 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1541 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1550 — 里程碑 — value/state changes; submit persists to local seed
- src/components/projects/TeamTaskWorkbench.tsx:1566 — 依赖任务 — value/state changes; submit persists to local seed
- src/components/projects/TeamTaskWorkbench.tsx:1588 — 截止时间 — value/state changes; submit persists to local seed
- src/components/projects/TeamTaskWorkbench.tsx:1607 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1608 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1611 — 验收标准 1 — value/state changes; submit persists to local seed
- src/components/projects/TeamTaskWorkbench.tsx:1625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1631 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1637 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1656 — 我已复核验收契约 — value/state changes; submit persists to local seed
- src/components/projects/TeamTaskWorkbench.tsx:1672 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/projects/TeamTaskWorkbench.tsx:1700 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/projects/TeamTaskWorkbench.tsx:1731 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/projects/TeamTaskWorkbench.tsx:1776 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/TeamProjectPage.tsx:561 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/TeamProjectPage.tsx:689 — [dynamic label] — visible state, dialog, route or recorded local request

### /organizations/invitations/accept

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/OrganizationInvitationAcceptPage.tsx:125 — [dynamic label] — visible state, dialog, route or recorded local request

### /starred

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/StarredPage.tsx:185 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StarredPage.tsx:193 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StarredPage.tsx:199 — [dynamic label] — route or new target URL
- src/pages/StarredPage.tsx:236 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StarredPage.tsx:257 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StarredPage.tsx:279 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/StarredPage.tsx:292 — [dynamic label] — visible state, dialog, route or recorded local request

### /files

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FilePreviewModal.tsx:221 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FilePreviewModal.tsx:227 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FilePreviewModal.tsx:245 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FilePreviewModal.tsx:262 — 关闭预览 — visible state, dialog, route or recorded local request
- src/components/FilePreviewModal.tsx:334 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FilePreviewModal.tsx:369 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:351 — 搜索文件名 — value/state changes; submit persists to local seed
- src/pages/FilesPage.tsx:365 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:366 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:371 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:376 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:384 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:385 — 文件排序 — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:396 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:399 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:410 — 网格视图 — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:419 — 列表视图 — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:430 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:482 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:531 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:605 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:658 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:701 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:720 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:737 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:750 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:751 — 更多操作 — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:762 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:767 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:772 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/FilesPage.tsx:776 — [dynamic label] — visible state, dialog, route or recorded local request

### /video

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request

### /video/edit/:projectId

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request

### /image

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/AttachmentChip.tsx:120 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AttachmentChip.tsx:129 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/CreativeInspiration.tsx:94 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/CreativeInspiration.tsx:108 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/CreativeInspiration.tsx:152 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/CreativeInspiration.tsx:177 — [dynamic label] — visible state, dialog, route or recorded local request
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
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FileDownloadCard.tsx:298 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FileDownloadCard.tsx:308 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/image/ImageBriefComposer.tsx:93 — 移除主角图 — visible state, dialog, route or recorded local request
- src/components/image/ImageBriefComposer.tsx:108 — 更换主角图 — visible state, dialog, route or recorded local request
- src/components/image/ImageBriefComposer.tsx:129 — 更换主角图 — visible state, dialog, route or recorded local request
- src/components/image/ImageBriefComposer.tsx:142 — 添加主角图 — visible state, dialog, route or recorded local request
- src/components/image/ImageBriefComposer.tsx:174 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/image/ImageBriefComposer.tsx:208 — 添加参考资料 — visible state, dialog, route or recorded local request
- src/components/image/ImageBriefComposer.tsx:225 — 描述你想要的最终画面 — value/state changes; submit persists to local seed
- src/components/image/ImageBriefComposer.tsx:247 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/image/ImageGenerationSettings.tsx:42 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/image/ImageGenerationSettings.tsx:88 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/image/ImageGenerationSettings.tsx:127 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/image/ImageGenerationSettings.tsx:140 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/image/ImageGenerationSettings.tsx:191 — 关闭生成设置 — visible state, dialog, route or recorded local request
- src/components/image/ImageGenerationSettings.tsx:232 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/image/ImageGoalPicker.tsx:32 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/image/ImageGoalPicker.tsx:61 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/image/ImageHistory.tsx:174 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/image/ImageHistory.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/image/ImageHistory.tsx:215 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/image/ImageHistory.tsx:246 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/image/ImageResultPanel.tsx:169 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/image/ImageResultPanel.tsx:178 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/image/ImageResultPanel.tsx:205 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/image/ImageResultPanel.tsx:215 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/textarea.tsx:9 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/ImagePage.tsx:422 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ImagePage.tsx:453 — 添加图片 — value/state changes; submit persists to local seed
- src/pages/ImagePage.tsx:467 — 选择图片模型 — visible state, dialog, route or recorded local request
- src/pages/ImagePage.tsx:484 — 生成设置 — visible state, dialog, route or recorded local request
- src/pages/ImagePage.tsx:505 — 添加参考资料 — visible state, dialog, route or recorded local request
- src/pages/ImagePage.tsx:525 — [dynamic label] — visible state, dialog, route or recorded local request

### /planned

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/textarea.tsx:9 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedScopeDialog.tsx:48 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedScopeDialog.tsx:51 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedScopeDialog.tsx:54 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedScopeDialog.tsx:58 — 取消 — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:759 — 把时间，留给重要的事。 — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:773 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:781 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:793 — 查找规划 — value/state changes; submit persists to local seed
- src/pages/planned/PlannedTasksPage.tsx:801 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:802 — 旧任务记录 — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:813 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:817 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:852 — 上一个月 — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:861 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:871 — 下一个月 — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:935 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:943 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:975 — 添加当天安排 — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:999 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:1041 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:1075 — 关闭 — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:1088 — 名称 — value/state changes; submit persists to local seed
- src/pages/planned/PlannedTasksPage.tsx:1098 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:1109 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:1130 — 描述这个任务 — value/state changes; submit persists to local seed
- src/pages/planned/PlannedTasksPage.tsx:1146 — 移除任务 — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:1165 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:1185 — 任务说明 — value/state changes; submit persists to local seed
- src/pages/planned/PlannedTasksPage.tsx:1210 — 统一要求（可选） — value/state changes; submit persists to local seed
- src/pages/planned/PlannedTasksPage.tsx:1224 — 日期 — value/state changes; submit persists to local seed
- src/pages/planned/PlannedTasksPage.tsx:1240 — 时间 — value/state changes; submit persists to local seed
- src/pages/planned/PlannedTasksPage.tsx:1268 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:1300 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:1330 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:1338 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:1353 — 结束日期 — value/state changes; submit persists to local seed
- src/pages/planned/PlannedTasksPage.tsx:1368 — 时区 — value/state changes; submit persists to local seed
- src/pages/planned/PlannedTasksPage.tsx:1382 — 提前提醒 — value/state changes; submit persists to local seed
- src/pages/planned/PlannedTasksPage.tsx:1412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:1416 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:1424 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:1494 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:1497 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:1597 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/planned/PlannedTasksPage.tsx:1606 — [dynamic label] — visible state, dialog, route or recorded local request

### /planned/legacy-scheduled

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ScheduledTaskDialog.tsx:200 — 新建定时任务 — visible state, dialog, route or recorded local request
- src/components/ScheduledTaskDialog.tsx:207 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ScheduledTaskDialog.tsx:222 — 关闭 — visible state, dialog, route or recorded local request
- src/components/ScheduledTaskDialog.tsx:236 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ScheduledTaskDialog.tsx:253 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ScheduledTaskDialog.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ScheduledTaskDialog.tsx:297 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ScheduledTaskDialog.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ScheduledTaskDialog.tsx:337 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ScheduledTaskDialog.tsx:349 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ScheduledTaskDialog.tsx:364 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ScheduledTaskDialog.tsx:382 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ScheduledTaskDialog.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/ScheduledPage.tsx:114 — 定时任务 — visible state, dialog, route or recorded local request
- src/pages/ScheduledPage.tsx:209 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ScheduledPage.tsx:223 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ScheduledPage.tsx:284 — [dynamic label] — visible state, dialog, route or recorded local request

### /planned/legacy-batch

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:219 — 新建批量任务 — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:226 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:235 — 关闭 — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:251 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/BatchTaskDialog.tsx:308 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:337 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:351 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:367 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/BatchTaskDialog.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/BatchTaskDialog.tsx:413 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/BatchTaskDialog.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:443 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:188 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:204 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:320 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:478 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:554 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:571 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:704 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:714 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:721 — [dynamic label] — route or new target URL
- src/pages/BatchPage.tsx:756 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:759 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:766 — [dynamic label] — route or new target URL

### /scheduled

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request

### /batch

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request

### /batch/:batchId

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:219 — 新建批量任务 — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:226 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:235 — 关闭 — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:251 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/BatchTaskDialog.tsx:308 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:337 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:351 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:367 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/BatchTaskDialog.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/BatchTaskDialog.tsx:413 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/BatchTaskDialog.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:443 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/BatchTaskDialog.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:188 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:204 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:272 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:320 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:478 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:554 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:571 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:635 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:704 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:714 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:721 — [dynamic label] — route or new target URL
- src/pages/BatchPage.tsx:756 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:759 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/BatchPage.tsx:766 — [dynamic label] — route or new target URL

### /connections

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/ConnectionsPage.tsx:137 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ConnectionsPage.tsx:140 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ConnectionsPage.tsx:141 — [dynamic label] — route or new target URL
- src/pages/ConnectionsPage.tsx:159 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ConnectionsPage.tsx:160 — [dynamic label] — route or new target URL
- src/pages/ConnectionsPage.tsx:244 — [dynamic label] — visible state, dialog, route or recorded local request
- src/pages/ConnectionsPage.tsx:250 — [dynamic label] — route or new target URL

### *

- src/components/AppShell.tsx:1010 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/AppShell.tsx:1108 — 浏览器工作区 — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:128 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ConfirmDialog.tsx:138 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:98 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:107 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:111 — 关闭 — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:139 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/FeedbackDialog.tsx:191 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/FeedbackDialog.tsx:200 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:400 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:409 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:412 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:446 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:450 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:455 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:464 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:465 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:471 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:483 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:491 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:492 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:498 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:505 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:513 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:514 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:524 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:536 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:537 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:547 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:559 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:560 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:568 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:574 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:582 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:590 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:609 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:625 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:636 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:661 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:720 — 6 位数字 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:733 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/LoginGate.tsx:757 — you@example.com — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:790 — 138 0000 0000 — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:826 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/LoginGate.tsx:835 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:118 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:142 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:173 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/QuotaIndicator.tsx:248 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:186 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:192 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:200 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/SearchOverlay.tsx:209 — 关闭 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:231 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:259 — 重试搜索 — visible state, dialog, route or recorded local request
- src/components/SearchOverlay.tsx:280 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:375 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:390 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:451 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:465 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:475 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:623 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:630 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:643 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:667 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:668 — 更多操作 — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:676 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:681 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:684 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:814 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:823 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:837 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:843 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:855 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:863 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:872 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:881 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:886 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:988 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1017 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1168 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1181 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1218 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/Sidebar.tsx:1256 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:66 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:67 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:158 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:189 — 任务菜单 — visible state, dialog, route or recorded local request
- src/components/TaskListItem.tsx:235 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UpdateBanner.tsx:64 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UpdateBanner.tsx:72 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:96 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:211 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/UserMenu.tsx:277 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:285 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:293 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:319 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/UserMenu.tsx:352 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:239 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:288 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:332 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:342 — 展开相同通知，逐条查看 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:356 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:367 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:427 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:457 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:500 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:607 — 关闭 — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:629 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/notifications/NotificationBell.tsx:639 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/choice-button.tsx:8 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/dropdown-menu.tsx:63 — [dynamic label] — visible state, dialog, route or recorded local request
- src/components/ui/input.tsx:6 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/sidebar.tsx:322 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:349 — 切换侧边栏 — visible state, dialog, route or recorded local request
- src/components/ui/sidebar.tsx:392 — [dynamic label] — value/state changes; submit persists to local seed
- src/components/ui/toast.tsx:50 — 关闭提示 — visible state, dialog, route or recorded local request
- src/pages/NotFoundPage.tsx:17 — 返回首页 — visible state, dialog, route or recorded local request
- src/pages/NotFoundPage.tsx:19 — [dynamic label] — visible state, dialog, route or recorded local request

## Interactive component candidates

Shared components may appear on multiple pages. Source line identities are stable; runtime inventories supply the page × component × outcome mapping.

| Source | Component | Label | Expected behavior |
| --- | --- | --- | --- |
| src/WorkbenchApp.tsx:862 | button | 收起浏览器 | visible state, dialog, route or recorded local request |
| src/components/AdminLayout.tsx:121 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ApiKeysSection.tsx:152 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ApiKeysSection.tsx:161 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ApiKeysSection.tsx:172 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ApiKeysSection.tsx:197 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ApiKeysSection.tsx:206 | input | 例如：Zapier 集成 / 内部脚本 | value/state changes; submit persists to local seed |
| src/components/ApiKeysSection.tsx:228 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ApiKeysSection.tsx:231 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ApiKeysSection.tsx:314 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ApiKeysSection.tsx:361 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ApiKeysSection.tsx:375 | summary | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ApiKeysSection.tsx:414 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ApiKeysSection.tsx:464 | button | 撤销 | visible state, dialog, route or recorded local request |
| src/components/AppShell.tsx:1010 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/AppShell.tsx:1108 | Button | 浏览器工作区 | visible state, dialog, route or recorded local request |
| src/components/AttachmentChip.tsx:120 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/AttachmentChip.tsx:129 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BatchTaskDialog.tsx:219 | div | 新建批量任务 | visible state, dialog, route or recorded local request |
| src/components/BatchTaskDialog.tsx:226 | div | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BatchTaskDialog.tsx:235 | button | 关闭 | visible state, dialog, route or recorded local request |
| src/components/BatchTaskDialog.tsx:251 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/BatchTaskDialog.tsx:308 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BatchTaskDialog.tsx:337 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BatchTaskDialog.tsx:351 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BatchTaskDialog.tsx:367 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/BatchTaskDialog.tsx:400 | textarea | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/BatchTaskDialog.tsx:413 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/BatchTaskDialog.tsx:427 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BatchTaskDialog.tsx:443 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BatchTaskDialog.tsx:451 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:1392 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:1414 | button | 收起浏览器 | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:1484 | button | 退出全屏 (Esc) | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:1559 | button | 停止当前任务 | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:1577 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:1613 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:1806 | img | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:1840 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:1872 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:1927 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:1947 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:1969 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:1984 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:2036 | div | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:2150 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:2163 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:2175 | button | 全屏查看任务截图 | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:2265 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:2327 | button | 收起操作日志 | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:2391 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/BrowserPanel.tsx:2482 | input | 中文 / 任意文本输入（先点击页面上的输入框获得焦点） | value/state changes; submit persists to local seed |
| src/components/BrowserPanel.tsx:2501 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:2515 | button | 关闭浮动输入框 | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:2579 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:2691 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:2754 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:3077 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/BrowserPanel.tsx:3129 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:3174 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:3348 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/BrowserPanel.tsx:3365 | button | [dynamic label] | visible state, dialog, route or recorded local request |
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
| src/components/CdpScreencastViewport.tsx:986 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/CnPaymentDialog.tsx:188 | div | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/CnPaymentDialog.tsx:195 | button | 关闭 | visible state, dialog, route or recorded local request |
| src/components/CnPaymentDialog.tsx:281 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ConfirmDialog.tsx:128 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ConfirmDialog.tsx:138 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/CreativeDisclosure.tsx:10 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/CreativeInspiration.tsx:94 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/CreativeInspiration.tsx:108 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/CreativeInspiration.tsx:152 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/CreativeInspiration.tsx:177 | button | [dynamic label] | visible state, dialog, route or recorded local request |
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
| src/components/FeedbackDialog.tsx:139 | textarea | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/FeedbackDialog.tsx:191 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/FeedbackDialog.tsx:200 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/FileDownloadCard.tsx:298 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/FileDownloadCard.tsx:308 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/FilePreviewModal.tsx:221 | div | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/FilePreviewModal.tsx:227 | div | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/FilePreviewModal.tsx:245 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/FilePreviewModal.tsx:262 | button | 关闭预览 | visible state, dialog, route or recorded local request |
| src/components/FilePreviewModal.tsx:334 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/FilePreviewModal.tsx:369 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:751 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:765 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:791 | Textarea | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/InputArea.tsx:841 | DropdownMenuTrigger | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:842 | button | 附件与任务选项 | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:861 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:878 | DropdownMenuRadioGroup | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:913 | DropdownMenuRadioGroup | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:956 | DropdownMenuRadioGroup | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:999 | button | 添加图片 | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:1010 | DropdownMenuTrigger | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:1011 | button | 选择技能 | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:1027 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:1046 | DropdownMenuTrigger | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:1047 | button | 执行模式 | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:1059 | DropdownMenuRadioGroup | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:1068 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:1081 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/InputArea.tsx:1093 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/InputArea.tsx:1104 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:1178 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:1354 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:1481 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/InputArea.tsx:1490 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LazyLoadBoundary.tsx:110 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LazyLoadBoundary.tsx:136 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LocalChromePicker.tsx:59 | DropdownMenuTrigger | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LocalChromePicker.tsx:60 | button | 选择 Chrome 页面 | visible state, dialog, route or recorded local request |
| src/components/LocalChromePicker.tsx:116 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LocalChromePicker.tsx:132 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LocalChromePicker.tsx:147 | button | 移除 Chrome 页面 | visible state, dialog, route or recorded local request |
| src/components/LocalChromeTaskPanel.tsx:53 | button | 关闭浏览器面板 | visible state, dialog, route or recorded local request |
| src/components/LocalChromeTaskPanel.tsx:104 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LocalChromeTaskPanel.tsx:119 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:400 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/LoginGate.tsx:409 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:412 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:446 | TabButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:450 | TabButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:455 | TabButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:464 | EmailInput | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/LoginGate.tsx:465 | PasswordInput | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/LoginGate.tsx:471 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:483 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:491 | EmailInput | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/LoginGate.tsx:492 | PasswordInput | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/LoginGate.tsx:498 | PasswordInput | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/LoginGate.tsx:505 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:513 | EmailInput | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/LoginGate.tsx:514 | CodeRow | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:524 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:536 | PhoneInput | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/LoginGate.tsx:537 | CodeRow | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:547 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:559 | EmailInput | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/LoginGate.tsx:560 | CodeRow | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:568 | PasswordInput | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/LoginGate.tsx:574 | PasswordInput | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/LoginGate.tsx:582 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:590 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:609 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:625 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:636 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:661 | ChoiceButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:720 | input | 6 位数字 | value/state changes; submit persists to local seed |
| src/components/LoginGate.tsx:733 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/LoginGate.tsx:757 | input | you@example.com | value/state changes; submit persists to local seed |
| src/components/LoginGate.tsx:790 | input | 138 0000 0000 | value/state changes; submit persists to local seed |
| src/components/LoginGate.tsx:826 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/LoginGate.tsx:835 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/MainPanel.tsx:182 | Button | 打开任务列表 | visible state, dialog, route or recorded local request |
| src/components/MainPanel.tsx:387 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ModelDataRegionDialog.tsx:77 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/ModelDataRegionDialog.tsx:108 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ModelDataRegionDialog.tsx:111 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/NewsDetailModal.tsx:137 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/NewsDetailModal.tsx:147 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/NewsDetailModal.tsx:157 | button | 关闭 | visible state, dialog, route or recorded local request |
| src/components/NewsDetailModal.tsx:250 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/NewsDetailModal.tsx:264 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/NewsDetailModal.tsx:300 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/PlanCard.tsx:93 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/PlanCard.tsx:140 | a | [dynamic label] | route or new target URL |
| src/components/QuotaIndicator.tsx:118 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/QuotaIndicator.tsx:142 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/QuotaIndicator.tsx:173 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/QuotaIndicator.tsx:248 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/RoleNudgeBanner.tsx:84 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/RoleNudgeBanner.tsx:91 | button | 关闭角色引导 | visible state, dialog, route or recorded local request |
| src/components/ScheduledTaskDialog.tsx:200 | div | 新建定时任务 | visible state, dialog, route or recorded local request |
| src/components/ScheduledTaskDialog.tsx:207 | div | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ScheduledTaskDialog.tsx:222 | button | 关闭 | visible state, dialog, route or recorded local request |
| src/components/ScheduledTaskDialog.tsx:236 | textarea | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/ScheduledTaskDialog.tsx:253 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/ScheduledTaskDialog.tsx:272 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ScheduledTaskDialog.tsx:297 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ScheduledTaskDialog.tsx:319 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ScheduledTaskDialog.tsx:337 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/ScheduledTaskDialog.tsx:349 | textarea | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/ScheduledTaskDialog.tsx:364 | textarea | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/ScheduledTaskDialog.tsx:382 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ScheduledTaskDialog.tsx:390 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/SearchOverlay.tsx:186 | div | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/SearchOverlay.tsx:192 | div | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/SearchOverlay.tsx:200 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/SearchOverlay.tsx:209 | button | 关闭 | visible state, dialog, route or recorded local request |
| src/components/SearchOverlay.tsx:231 | button | 重试搜索 | visible state, dialog, route or recorded local request |
| src/components/SearchOverlay.tsx:259 | Button | 重试搜索 | visible state, dialog, route or recorded local request |
| src/components/SearchOverlay.tsx:280 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/SearchResultCard.tsx:78 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/SearchResultCard.tsx:124 | a | [dynamic label] | route or new target URL |
| src/components/Sidebar.tsx:375 | SidebarMenuButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:390 | SidebarMenuButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:451 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:465 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:475 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:623 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:630 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:643 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:667 | DropdownMenuTrigger | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:668 | button | 更多操作 | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:676 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:681 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:684 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:814 | DropdownMenuTrigger | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:823 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:837 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:843 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:855 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:863 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:872 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:881 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:886 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:988 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:1017 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:1168 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:1181 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:1218 | SidebarMenuButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/Sidebar.tsx:1256 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/StepCard.tsx:148 | a | [dynamic label] | route or new target URL |
| src/components/TaskListItem.tsx:66 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskListItem.tsx:67 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskListItem.tsx:158 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskListItem.tsx:189 | button | 任务菜单 | visible state, dialog, route or recorded local request |
| src/components/TaskListItem.tsx:235 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/TaskStream.tsx:794 | summary | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:824 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:947 | a | [dynamic label] | route or new target URL |
| src/components/TaskStream.tsx:1149 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:1157 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:1165 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:1186 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:1196 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:1210 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:1219 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:1228 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:1246 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:1255 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:1306 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:1648 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:1698 | summary | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:1921 | button | 重新执行任务 | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:2018 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:2159 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:2318 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:2684 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:2699 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:2710 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:2736 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:2828 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:2838 | DropdownMenuTrigger | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:2839 | button | 打开更多结果操作 | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:2854 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:2861 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:2875 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:2887 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:2920 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/TaskStream.tsx:3085 | a | [dynamic label] | route or new target URL |
| src/components/TaskToolbar.tsx:76 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/UpdateBanner.tsx:64 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/UpdateBanner.tsx:72 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/UserMenu.tsx:96 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/UserMenu.tsx:211 | ThemeSwitcher | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/UserMenu.tsx:277 | ThemeOption | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/UserMenu.tsx:285 | ThemeOption | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/UserMenu.tsx:293 | ThemeOption | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/UserMenu.tsx:319 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/UserMenu.tsx:352 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/astrology/AstroTaskCompanion.tsx:128 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/astrology/AstroTaskCompanion.tsx:155 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/billing/PaymentLedgerSection.tsx:186 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/billing/PaymentLedgerSection.tsx:272 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/billing/PaymentLedgerSection.tsx:320 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/billing/PaymentLedgerSection.tsx:331 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/billing/PaymentLedgerSection.tsx:394 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/billing/PaymentLedgerSection.tsx:405 | a | [dynamic label] | route or new target URL |
| src/components/energy/AstrologyDimensionGrid.tsx:73 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/AstrologyDimensionGrid.tsx:104 | button | [dynamic label] | visible state, dialog, route or recorded local request |
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
| src/components/energy/ExperiencePlayer.tsx:106 | Button | 关闭体验 | visible state, dialog, route or recorded local request |
| src/components/energy/ExperiencePlayer.tsx:124 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/ExperiencePlayer.tsx:146 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/ExperiencePlayer.tsx:149 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/MoodCheckIn.tsx:28 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/RunningTaskDock.tsx:86 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/HoroscopeExperience.tsx:81 | button | 更新星座提示 | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/HoroscopeExperience.tsx:96 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/HoroscopeExperience.tsx:99 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/HoroscopeExperience.tsx:153 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/MiniGameExperience.tsx:66 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/PollExperience.tsx:57 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/PollExperience.tsx:90 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/energy/experiences/PracticeExperience.tsx:80 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/PracticeExperience.tsx:90 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/PracticeExperience.tsx:98 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/RechargeExperience.tsx:88 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/RechargeExperience.tsx:124 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/RechargeExperience.tsx:127 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
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
| src/components/energy/experiences/TestExperience.tsx:161 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/TestExperience.tsx:213 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/TestExperience.tsx:216 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/TestExperience.tsx:223 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/TestExperience.tsx:226 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/TestExperience.tsx:237 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/TestExperience.tsx:276 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/TestExperience.tsx:289 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/games/BreathRhythmGame.tsx:36 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/games/CatchEnergyGame.tsx:32 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/games/ColorMemoryGame.tsx:101 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/games/ColorMemoryGame.tsx:110 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/energy/experiences/games/ColorMemoryGame.tsx:123 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/image/ImageBriefComposer.tsx:93 | button | 移除主角图 | visible state, dialog, route or recorded local request |
| src/components/image/ImageBriefComposer.tsx:108 | button | 更换主角图 | visible state, dialog, route or recorded local request |
| src/components/image/ImageBriefComposer.tsx:129 | button | 更换主角图 | visible state, dialog, route or recorded local request |
| src/components/image/ImageBriefComposer.tsx:142 | button | 添加主角图 | visible state, dialog, route or recorded local request |
| src/components/image/ImageBriefComposer.tsx:174 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/image/ImageBriefComposer.tsx:208 | button | 添加参考资料 | visible state, dialog, route or recorded local request |
| src/components/image/ImageBriefComposer.tsx:225 | Textarea | 描述你想要的最终画面 | value/state changes; submit persists to local seed |
| src/components/image/ImageBriefComposer.tsx:247 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/image/ImageGenerationSettings.tsx:42 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/image/ImageGenerationSettings.tsx:88 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/image/ImageGenerationSettings.tsx:127 | ChoiceButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/image/ImageGenerationSettings.tsx:140 | ChoiceButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/image/ImageGenerationSettings.tsx:191 | button | 关闭生成设置 | visible state, dialog, route or recorded local request |
| src/components/image/ImageGenerationSettings.tsx:232 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/image/ImageGoalPicker.tsx:32 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/image/ImageGoalPicker.tsx:61 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/image/ImageHistory.tsx:174 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/image/ImageHistory.tsx:200 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/image/ImageHistory.tsx:215 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/image/ImageHistory.tsx:246 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/image/ImageResultPanel.tsx:169 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/image/ImageResultPanel.tsx:178 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/image/ImageResultPanel.tsx:205 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/image/ImageResultPanel.tsx:215 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/notifications/AddChannelModal.tsx:195 | button | 关闭 | visible state, dialog, route or recorded local request |
| src/components/notifications/AddChannelModal.tsx:214 | ChoiceButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/notifications/AddChannelModal.tsx:250 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/notifications/AddChannelModal.tsx:273 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/notifications/AddChannelModal.tsx:303 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/notifications/AddChannelModal.tsx:312 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/notifications/NotificationBell.tsx:239 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/notifications/NotificationBell.tsx:288 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/notifications/NotificationBell.tsx:332 | NotificationItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/notifications/NotificationBell.tsx:342 | summary | 展开相同通知，逐条查看 | visible state, dialog, route or recorded local request |
| src/components/notifications/NotificationBell.tsx:356 | NotificationItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/notifications/NotificationBell.tsx:367 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/notifications/NotificationBell.tsx:427 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/notifications/NotificationBell.tsx:457 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/notifications/NotificationBell.tsx:500 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/notifications/NotificationBell.tsx:607 | button | 关闭 | visible state, dialog, route or recorded local request |
| src/components/notifications/NotificationBell.tsx:629 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/notifications/NotificationBell.tsx:639 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/notifications/NotificationsSection.tsx:60 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/notifications/NotificationsSection.tsx:278 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/notifications/NotificationsSection.tsx:296 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/notifications/NotificationsSection.tsx:346 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/notifications/NotificationsSection.tsx:359 | button | [dynamic label] | visible state, dialog, route or recorded local request |
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
| src/components/projects/TeamTaskWorkbench.tsx:277 | TaskTabs | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:289 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:302 | input | 搜索项目任务 | value/state changes; submit persists to local seed |
| src/components/projects/TeamTaskWorkbench.tsx:314 | summary | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:320 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:335 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:383 | summary | 项目进展与权限 | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:433 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:505 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:544 | button | 列表视图 | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:557 | button | 看板视图 | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:572 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:594 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:671 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:751 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:879 | button | 关闭任务详情 | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:980 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:997 | Field | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:998 | Field | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1001 | input | 复核时间 | value/state changes; submit persists to local seed |
| src/components/projects/TeamTaskWorkbench.tsx:1010 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/projects/TeamTaskWorkbench.tsx:1017 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1039 | Field | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1040 | Field | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1041 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1057 | Field | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1058 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1071 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1080 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1093 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1100 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1107 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1114 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1132 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1274 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1283 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1304 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/projects/TeamTaskWorkbench.tsx:1320 | Field | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1321 | Field | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1324 | input | 新截止时间 | value/state changes; submit persists to local seed |
| src/components/projects/TeamTaskWorkbench.tsx:1333 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1342 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1366 | textarea | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/projects/TeamTaskWorkbench.tsx:1487 | button | 关闭新建任务 | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1499 | Field | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1510 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1528 | MemberSelect | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1541 | MultiMemberSelect | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1550 | select | 里程碑 | value/state changes; submit persists to local seed |
| src/components/projects/TeamTaskWorkbench.tsx:1566 | select | 依赖任务 | value/state changes; submit persists to local seed |
| src/components/projects/TeamTaskWorkbench.tsx:1588 | input | 截止时间 | value/state changes; submit persists to local seed |
| src/components/projects/TeamTaskWorkbench.tsx:1607 | Field | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1608 | Field | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1611 | textarea | 验收标准 1 | value/state changes; submit persists to local seed |
| src/components/projects/TeamTaskWorkbench.tsx:1625 | Field | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1631 | MemberSelect | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1637 | MemberSelect | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1656 | input | 我已复核验收契约 | value/state changes; submit persists to local seed |
| src/components/projects/TeamTaskWorkbench.tsx:1672 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/TeamTaskWorkbench.tsx:1700 | select | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/projects/TeamTaskWorkbench.tsx:1731 | select | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/projects/TeamTaskWorkbench.tsx:1776 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/WorkspaceSwitcher.tsx:45 | DropdownMenuTrigger | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/WorkspaceSwitcher.tsx:46 | button | 切换工作区 | visible state, dialog, route or recorded local request |
| src/components/projects/WorkspaceSwitcher.tsx:56 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/WorkspaceSwitcher.tsx:61 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/WorkspaceSwitcher.tsx:74 | Button | 刷新团队空间 | visible state, dialog, route or recorded local request |
| src/components/projects/WorkspaceSwitcher.tsx:86 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/projects/WorkspaceSwitcher.tsx:105 | button | [dynamic label] | visible state, dialog, route or recorded local request |
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
| src/components/settings/ModelDataRegionSection.tsx:56 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
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
| src/components/skills/CapabilityCenterContent.tsx:198 | a | [dynamic label] | route or new target URL |
| src/components/skills/CapabilityCenterContent.tsx:222 | button | 移除已选任务 | visible state, dialog, route or recorded local request |
| src/components/skills/CapabilityCenterContent.tsx:273 | textarea | 描述想完成的任务 | value/state changes; submit persists to local seed |
| src/components/skills/CapabilityCenterContent.tsx:286 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/skills/CapabilityCenterContent.tsx:328 | button | 添加附件 | visible state, dialog, route or recorded local request |
| src/components/skills/CapabilityCenterContent.tsx:344 | DropdownMenuTrigger | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/skills/CapabilityCenterContent.tsx:345 | button | 选择任务使用的技能 | visible state, dialog, route or recorded local request |
| src/components/skills/CapabilityCenterContent.tsx:380 | input | 搜索技能 | value/state changes; submit persists to local seed |
| src/components/skills/CapabilityCenterContent.tsx:391 | DropdownMenuItem | 自动匹配 | visible state, dialog, route or recorded local request |
| src/components/skills/CapabilityCenterContent.tsx:412 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/skills/CapabilityCenterContent.tsx:441 | input | 选择任务附件 | value/state changes; submit persists to local seed |
| src/components/skills/CapabilityCenterContent.tsx:498 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/skills/CapabilityCenterContent.tsx:526 | button | 执行预览 | visible state, dialog, route or recorded local request |
| src/components/skills/CapabilityCenterContent.tsx:586 | button | 选择这个任务示例 | visible state, dialog, route or recorded local request |
| src/components/skills/CapabilityCenterContent.tsx:626 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/skills/CapabilityCenterContent.tsx:680 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/skills/CapabilityCenterContent.tsx:698 | button | [dynamic label] | visible state, dialog, route or recorded local request |
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
| src/components/stocks/StockAiCommandComposer.tsx:77 | ApprovedStockComposer | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockAiCommandComposer.tsx:124 | button | 管理研究范围 | visible state, dialog, route or recorded local request |
| src/components/stocks/StockAiCommandComposer.tsx:133 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockAiCommandComposer.tsx:164 | textarea | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/stocks/StockAiCommandComposer.tsx:178 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/stocks/StockAiCommandComposer.tsx:189 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockAiCommandComposer.tsx:200 | button | 提交股市任务 | visible state, dialog, route or recorded local request |
| src/components/stocks/StockAiCommandComposer.tsx:225 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockPreferenceProfile.tsx:191 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockPreferenceProfile.tsx:202 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockPreferenceProfile.tsx:214 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockPreferenceProfile.tsx:308 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockPreferenceProfile.tsx:330 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockPreferenceProfile.tsx:359 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockPreferenceProfile.tsx:485 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockPreferenceProfile.tsx:636 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/stocks/StockPreferenceProfile.tsx:672 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockPreferenceProfile.tsx:682 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockPreferenceProfile.tsx:695 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockPreferenceProfile.tsx:703 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockRiskMonitorSheet.tsx:85 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockRiskMonitorSheet.tsx:93 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockRiskRadar.tsx:341 | button | 刷新风险雷达 | visible state, dialog, route or recorded local request |
| src/components/stocks/StockRiskRadar.tsx:568 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockRiskRadar.tsx:590 | a | [dynamic label] | route or new target URL |
| src/components/stocks/StockRiskRadar.tsx:608 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockRiskRadar.tsx:697 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockRiskRadar.tsx:740 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockRiskRadar.tsx:753 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockRiskRadar.tsx:768 | a | [dynamic label] | route or new target URL |
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
| src/components/stocks/StockWorkbenchLayout.tsx:118 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockWorkbenchLayout.tsx:224 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/stocks/StockWorkbenchLayout.tsx:294 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ui/choice-button.tsx:8 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ui/dropdown-menu.tsx:63 | DropdownMenuPrimitive.SubTrigger | [dynamic label] | visible state, dialog, route or recorded local request |
| src/components/ui/input.tsx:6 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/ui/sidebar.tsx:322 | Button | 切换侧边栏 | visible state, dialog, route or recorded local request |
| src/components/ui/sidebar.tsx:349 | button | 切换侧边栏 | visible state, dialog, route or recorded local request |
| src/components/ui/sidebar.tsx:392 | Input | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/ui/textarea.tsx:9 | textarea | [dynamic label] | value/state changes; submit persists to local seed |
| src/components/ui/toast.tsx:50 | button | 关闭提示 | visible state, dialog, route or recorded local request |
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
| src/pages/BatchPage.tsx:188 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/BatchPage.tsx:204 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/BatchPage.tsx:272 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/BatchPage.tsx:320 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/BatchPage.tsx:478 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/BatchPage.tsx:554 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/BatchPage.tsx:571 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/BatchPage.tsx:635 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/BatchPage.tsx:704 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/BatchPage.tsx:714 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/BatchPage.tsx:721 | a | [dynamic label] | route or new target URL |
| src/pages/BatchPage.tsx:756 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/BatchPage.tsx:759 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/BatchPage.tsx:766 | a | [dynamic label] | route or new target URL |
| src/pages/BillingPage.tsx:170 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/BillingPage.tsx:173 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/BillingPage.tsx:179 | a | [dynamic label] | route or new target URL |
| src/pages/BillingPage.tsx:201 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/BillingPage.tsx:225 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/BillingPage.tsx:231 | a | [dynamic label] | route or new target URL |
| src/pages/BillingPage.tsx:242 | a | [dynamic label] | route or new target URL |
| src/pages/BillingPage.tsx:271 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/BillingPage.tsx:277 | a | [dynamic label] | route or new target URL |
| src/pages/ConnectionsPage.tsx:137 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ConnectionsPage.tsx:140 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ConnectionsPage.tsx:141 | a | [dynamic label] | route or new target URL |
| src/pages/ConnectionsPage.tsx:159 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ConnectionsPage.tsx:160 | a | [dynamic label] | route or new target URL |
| src/pages/ConnectionsPage.tsx:244 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ConnectionsPage.tsx:250 | a | [dynamic label] | route or new target URL |
| src/pages/FilesPage.tsx:351 | input | 搜索文件名 | value/state changes; submit persists to local seed |
| src/pages/FilesPage.tsx:365 | FilterTab | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:366 | FilterTab | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:371 | FilterTab | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:376 | FilterTab | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:384 | DropdownMenuTrigger | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:385 | button | 文件排序 | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:396 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:399 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:410 | button | 网格视图 | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:419 | button | 列表视图 | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:430 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:457 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:482 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:531 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:537 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:605 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:658 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:701 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:720 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:737 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:750 | DropdownMenuTrigger | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:751 | button | 更多操作 | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:762 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:767 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:772 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/FilesPage.tsx:776 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/HistoryPage.tsx:297 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/HistoryPage.tsx:309 | input | 搜索任务内容 | value/state changes; submit persists to local seed |
| src/pages/HistoryPage.tsx:335 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/HistoryPage.tsx:344 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/HistoryPage.tsx:350 | a | [dynamic label] | route or new target URL |
| src/pages/HistoryPage.tsx:366 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/HistoryPage.tsx:391 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/HistoryPage.tsx:431 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/HistoryPage.tsx:445 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/HistoryPage.tsx:474 | ChoiceButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ImagePage.tsx:422 | ImageGoalPicker | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ImagePage.tsx:453 | input | 添加图片 | value/state changes; submit persists to local seed |
| src/pages/ImagePage.tsx:467 | button | 选择图片模型 | visible state, dialog, route or recorded local request |
| src/pages/ImagePage.tsx:484 | button | 生成设置 | visible state, dialog, route or recorded local request |
| src/pages/ImagePage.tsx:505 | button | 添加参考资料 | visible state, dialog, route or recorded local request |
| src/pages/ImagePage.tsx:525 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/NotFoundPage.tsx:17 | Button | 返回首页 | visible state, dialog, route or recorded local request |
| src/pages/NotFoundPage.tsx:19 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/OrganizationInvitationAcceptPage.tsx:125 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PartnerPage.tsx:214 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PartnerPage.tsx:498 | StatusPanel | 刷新失败，正在显示上次账本 | visible state, dialog, route or recorded local request |
| src/pages/PartnerPage.tsx:522 | StatusPanel | 合伙人账本暂时无法加载 | visible state, dialog, route or recorded local request |
| src/pages/PartnerPage.tsx:777 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PartnerPage.tsx:823 | Input | bank_fp_... | value/state changes; submit persists to local seed |
| src/pages/PartnerPage.tsx:833 | Input | bankcard-flow-... | value/state changes; submit persists to local seed |
| src/pages/PartnerPage.tsx:843 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PartnerPage.tsx:873 | Input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/PartnerPage.tsx:874 | Button | 复制我的邀请码 | visible state, dialog, route or recorded local request |
| src/pages/PartnerPage.tsx:891 | Input | usr_... | value/state changes; submit persists to local seed |
| src/pages/PartnerPage.tsx:902 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/PartnerPage.tsx:911 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PartnerPage.tsx:1010 | PartnerPaymentProviderSelect | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PartnerPage.tsx:1017 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PartnerPage.tsx:1050 | Input | 例如 5000 | value/state changes; submit persists to local seed |
| src/pages/PartnerPage.tsx:1062 | Input | bank_fp_... | value/state changes; submit persists to local seed |
| src/pages/PartnerPage.tsx:1073 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PartnerPage.tsx:1102 | Input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/PartnerPage.tsx:1117 | PartnerPaymentProviderSelect | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PartnerPage.tsx:1128 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/PartnerPage.tsx:1151 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PartnerPage.tsx:1164 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PartnerPage.tsx:1205 | select | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/PartnerPage.tsx:1280 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PlanPage.tsx:191 | ChoiceButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PlanPage.tsx:204 | ChoiceButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PlanPage.tsx:385 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PlanPage.tsx:395 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PlanPage.tsx:399 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PlanPage.tsx:404 | a | [dynamic label] | route or new target URL |
| src/pages/PlanPage.tsx:419 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PlanPage.tsx:437 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PlanPage.tsx:476 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PlanPage.tsx:571 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PlanPage.tsx:585 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PlanPage.tsx:613 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PlanPage.tsx:640 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/PlanPage.tsx:646 | a | [dynamic label] | route or new target URL |
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
| src/pages/ProjectsPage.tsx:763 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:774 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:789 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:821 | input | 搜索项目 | value/state changes; submit persists to local seed |
| src/pages/ProjectsPage.tsx:890 | PersonalCreateForm | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:1058 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:1078 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:1095 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:1121 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:1147 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:1171 | DropdownMenuTrigger | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:1172 | button | 更多 | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:1185 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:1190 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:1256 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/ProjectsPage.tsx:1287 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:1299 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:1345 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:1422 | button | 关闭 | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:1434 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/ProjectsPage.tsx:1449 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ProjectsPage.tsx:1459 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/RolesPage.tsx:181 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/RolesPage.tsx:184 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/RolesPage.tsx:185 | a | [dynamic label] | route or new target URL |
| src/pages/RolesPage.tsx:232 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/RolesPage.tsx:308 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/RolesPage.tsx:311 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/RolesPage.tsx:353 | RoleCard | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/RolesPage.tsx:382 | Tag | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ScheduledPage.tsx:114 | PageHeader | 定时任务 | visible state, dialog, route or recorded local request |
| src/pages/ScheduledPage.tsx:209 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ScheduledPage.tsx:223 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/ScheduledPage.tsx:284 | button | [dynamic label] | visible state, dialog, route or recorded local request |
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
| src/pages/StarredPage.tsx:185 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StarredPage.tsx:193 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StarredPage.tsx:199 | a | [dynamic label] | route or new target URL |
| src/pages/StarredPage.tsx:236 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StarredPage.tsx:257 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StarredPage.tsx:279 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StarredPage.tsx:292 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockDiscoveryPage.tsx:247 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockDiscoveryPage.tsx:266 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockDiscoveryPage.tsx:281 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockDiscoveryPage.tsx:372 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:756 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:771 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:818 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:821 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:851 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:1222 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:1276 | button | 上一页动态 | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:1287 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:1305 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:1320 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:1387 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:1429 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:1629 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:1785 | Input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/StockTasksPage.tsx:1801 | select | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/StockTasksPage.tsx:1829 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:1852 | Input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/StockTasksPage.tsx:1863 | Input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/StockTasksPage.tsx:1872 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:1925 | Input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/StockTasksPage.tsx:1937 | Input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/StockTasksPage.tsx:1952 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:1960 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:2489 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:2541 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/StockTasksPage.tsx:2582 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/TeamProjectPage.tsx:561 | PageHeader | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/TeamProjectPage.tsx:689 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/TermsPage.tsx:101 | a | support@holaday.ai | route or new target URL |
| src/pages/UsagePage.tsx:87 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/UsagePage.tsx:128 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/UsagePage.tsx:138 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/UsagePage.tsx:144 | a | [dynamic label] | route or new target URL |
| src/pages/UsagePage.tsx:181 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/UsagePage.tsx:184 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/UsagePage.tsx:190 | a | [dynamic label] | route or new target URL |
| src/pages/UsagePage.tsx:298 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:969 | button | 模型与生成设置 | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:990 | button | 移除模板 | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1042 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1098 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1118 | CreativeSegment | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1126 | CreativeSegment | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1197 | button | 添加参考素材 | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1223 | Textarea | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/VideoPage.tsx:1232 | button | 添加本地资料 | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1241 | button | 添加参考图 | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1251 | button | 添加参考视频 | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1262 | button | 调整视频规格 | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1278 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1290 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/VideoPage.tsx:1301 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/VideoPage.tsx:1336 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/VideoPage.tsx:1347 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1534 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1552 | CreativeStyleDialog | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1630 | button | 关闭风格选择 | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1644 | ChoiceButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1668 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1755 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1788 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1816 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:1869 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2157 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2185 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2210 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2263 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2319 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2409 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2447 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2616 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2658 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2668 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2678 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2693 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2735 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2885 | Textarea | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/VideoPage.tsx:2899 | SegGroup | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2900 | SegGroup | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2901 | SegGroup | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2907 | SegGroup | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2913 | SegGroup | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:2947 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:3155 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/VideoPage.tsx:3162 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/VideoPage.tsx:3171 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:3187 | button | 移除主角照片 | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:3200 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:3216 | button | 移除参考视频 | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:3250 | Textarea | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/VideoPage.tsx:3259 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:3268 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:3280 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:3322 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:3569 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:3592 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/VideoPage.tsx:3599 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/VideoPage.tsx:3609 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:3615 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:3631 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:3661 | summary | 隐私与素材管理 | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:3665 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:3753 | Textarea | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/VideoPage.tsx:3762 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:3766 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:3773 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/VideoPage.tsx:3793 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminFinancePage.tsx:143 | TabButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminFinancePage.tsx:146 | TabButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminFinancePage.tsx:242 | ChoiceButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminFinancePage.tsx:886 | input | 成本查询任务 ID | value/state changes; submit persists to local seed |
| src/pages/admin/AdminFinancePage.tsx:894 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminLearningDomainPage.tsx:264 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminLearningPage.tsx:139 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminLearningPage.tsx:147 | FilterPill | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminLearningPage.tsx:150 | FilterPill | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminLearningPage.tsx:153 | FilterPill | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminLearningPage.tsx:206 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminLearningPage.tsx:219 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminLearningPage.tsx:386 | ChoiceButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminModelsPage.tsx:141 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminModelsPage.tsx:173 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminModelsPage.tsx:186 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminModelsPage.tsx:207 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminModelsPage.tsx:219 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminModelsPage.tsx:319 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminModelsPage.tsx:337 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminModelsPage.tsx:343 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminModelsPage.tsx:349 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminPartnerReviewPage.tsx:275 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminPartnerReviewPage.tsx:522 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminPartnerReviewPage.tsx:569 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminPartnerReviewPage.tsx:655 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminPartnerReviewPage.tsx:662 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminPartnerReviewPage.tsx:669 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminPartnerReviewPage.tsx:676 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminPartnerReviewPage.tsx:837 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminPartnerReviewPage.tsx:843 | select | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminPartnerReviewPage.tsx:853 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminPartnerReviewPage.tsx:859 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminPartnerReviewPage.tsx:865 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminPartnerReviewPage.tsx:871 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminPartnerReviewPage.tsx:877 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminPartnerReviewPage.tsx:935 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminPartnerReviewPage.tsx:960 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminPartnerReviewPage.tsx:1058 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminPartnerReviewPage.tsx:1071 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminPartnerReviewPage.tsx:1083 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminPartnerReviewPage.tsx:1184 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminPartnerReviewPage.tsx:1210 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminPartnerReviewPage.tsx:1221 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminPartnerReviewPage.tsx:1249 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminPartnerReviewPage.tsx:1260 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminPartnerReviewPage.tsx:1363 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminPartnerReviewPage.tsx:1374 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminPartnerReviewPage.tsx:1512 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminPartnerReviewPage.tsx:1523 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminPartnerReviewPage.tsx:1561 | select | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminPartnerReviewPage.tsx:1577 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminPartnerReviewPage.tsx:1588 | ActionButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminPartnerReviewPage.tsx:1837 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminSelfCheckPage.tsx:67 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminSelfCheckPage.tsx:76 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminUsersPage.tsx:121 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/admin/AdminUsersPage.tsx:131 | SortPill | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminUsersPage.tsx:137 | SortPill | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminUsersPage.tsx:143 | SortPill | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminUsersPage.tsx:244 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminUsersPage.tsx:258 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/admin/AdminUsersPage.tsx:306 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedScopeDialog.tsx:48 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedScopeDialog.tsx:51 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedScopeDialog.tsx:54 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedScopeDialog.tsx:58 | Button | 取消 | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:759 | PageHeader | 把时间，留给重要的事。 | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:773 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:781 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:793 | input | 查找规划 | value/state changes; submit persists to local seed |
| src/pages/planned/PlannedTasksPage.tsx:801 | DropdownMenuTrigger | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:802 | Button | 旧任务记录 | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:813 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:817 | DropdownMenuItem | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:852 | Button | 上一个月 | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:861 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:871 | Button | 下一个月 | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:935 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:943 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:975 | button | 添加当天安排 | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:999 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:1041 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:1075 | Button | 关闭 | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:1088 | Input | 名称 | value/state changes; submit persists to local seed |
| src/pages/planned/PlannedTasksPage.tsx:1098 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:1109 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:1130 | Input | 描述这个任务 | value/state changes; submit persists to local seed |
| src/pages/planned/PlannedTasksPage.tsx:1146 | Button | 移除任务 | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:1165 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:1185 | Textarea | 任务说明 | value/state changes; submit persists to local seed |
| src/pages/planned/PlannedTasksPage.tsx:1210 | Textarea | 统一要求（可选） | value/state changes; submit persists to local seed |
| src/pages/planned/PlannedTasksPage.tsx:1224 | Input | 日期 | value/state changes; submit persists to local seed |
| src/pages/planned/PlannedTasksPage.tsx:1240 | Input | 时间 | value/state changes; submit persists to local seed |
| src/pages/planned/PlannedTasksPage.tsx:1268 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:1300 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:1330 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:1338 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:1353 | Input | 结束日期 | value/state changes; submit persists to local seed |
| src/pages/planned/PlannedTasksPage.tsx:1368 | select | 时区 | value/state changes; submit persists to local seed |
| src/pages/planned/PlannedTasksPage.tsx:1382 | select | 提前提醒 | value/state changes; submit persists to local seed |
| src/pages/planned/PlannedTasksPage.tsx:1412 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:1416 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:1424 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:1494 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:1497 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:1597 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/planned/PlannedTasksPage.tsx:1606 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/scheduled-calendar/EventDetailPopover.tsx:268 | select | 失败通知阈值 | value/state changes; submit persists to local seed |
| src/pages/scheduled-calendar/EventDetailPopover.tsx:288 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/scheduled-calendar/EventDetailPopover.tsx:307 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/scheduled-calendar/EventDetailPopover.tsx:328 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/scheduled-calendar/EventDetailPopover.tsx:349 | Button | 删除定时任务 | visible state, dialog, route or recorded local request |
| src/pages/scheduled-calendar/QuickCreatePopover.tsx:228 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/scheduled-calendar/QuickCreatePopover.tsx:243 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/scheduled-calendar/QuickCreatePopover.tsx:256 | textarea | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/scheduled-calendar/QuickCreatePopover.tsx:272 | input | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/scheduled-calendar/QuickCreatePopover.tsx:293 | ChoiceButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/scheduled-calendar/QuickCreatePopover.tsx:317 | ChoiceButton | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/scheduled-calendar/QuickCreatePopover.tsx:337 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/scheduled-calendar/QuickCreatePopover.tsx:359 | textarea | [dynamic label] | value/state changes; submit persists to local seed |
| src/pages/scheduled-calendar/QuickCreatePopover.tsx:385 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/scheduled-calendar/QuickCreatePopover.tsx:395 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/scheduled-calendar/ScheduledCalendarPage.tsx:762 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/scheduled-calendar/ScheduledCalendarPage.tsx:778 | button | 上一个 | visible state, dialog, route or recorded local request |
| src/pages/scheduled-calendar/ScheduledCalendarPage.tsx:787 | button | 下一个 | visible state, dialog, route or recorded local request |
| src/pages/scheduled-calendar/ScheduledCalendarPage.tsx:796 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/scheduled-calendar/ScheduledCalendarPage.tsx:813 | button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/scheduled-calendar/ScheduledCalendarPage.tsx:850 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/scheduled-calendar/ScheduledCalendarPage.tsx:860 | Button | [dynamic label] | visible state, dialog, route or recorded local request |
| src/pages/scheduled-calendar/ScheduledCalendarPage.tsx:867 | a | [dynamic label] | route or new target URL |
