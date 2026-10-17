# UI regression report

Result: **failed** · candidate `ff1e30d9b357c7d499335f47f1604cb108030a49` · seed `2026-10-09-v2`

Frontend source: `345eb8b47855551898ea5f1e0f49e55e1b9ac197ce1d7262fea418b0fc5243a4`; build: `f8a3ea427b5f5777cb14e3d583db14c25f1ba974ef442403464ca0cffd632e39`.

Local seeded frontend/backend only. Production, paid services and real accounts are not contacted. Baseline creation is not a passed comparison.

Pages: 9/9; findings: 16; coverage gaps: 2.

## Findings

| Severity | Route / width | Rule | Detail | Screenshot |
| --- | --- | --- | --- | --- |
| P1 | /stocks / 1440 | control-occluded | BUTTON\|tab\|条件选股\|\|0 | [image](artifacts/1440-_stocks.png) |
| P1 | /stocks / 1440 | control-occluded | BUTTON\|tab\|风险证据\|\|0 | [image](artifacts/1440-_stocks.png) |
| P1 | /stocks / 1440 | control-occluded | BUTTON\|tab\|交易日简报\|\|0 | [image](artifacts/1440-_stocks.png) |
| P1 | /stocks / 1440 | control-overlap | BUTTON\|\|选择参考资料\|\|0 / BUTTON\|tab\|风险证据\|\|0 | [image](artifacts/1440-_stocks.png) |
| P1 | /stocks / 1280 | control-occluded | BUTTON\|tab\|关注股票\|\|0 | [image](artifacts/1280-_stocks.png) |
| P1 | /stocks / 1280 | control-occluded | BUTTON\|tab\|条件选股\|\|0 | [image](artifacts/1280-_stocks.png) |
| P1 | /stocks / 1280 | control-occluded | BUTTON\|tab\|风险证据\|\|0 | [image](artifacts/1280-_stocks.png) |
| P1 | /stocks / 1280 | control-occluded | BUTTON\|tab\|交易日简报\|\|0 | [image](artifacts/1280-_stocks.png) |
| P1 | /stocks / 1280 | control-overlap | BUTTON\|\|选择参考资料\|\|0 / BUTTON\|tab\|条件选股\|\|0 | [image](artifacts/1280-_stocks.png) |
| P2 | /stocks / 1280 | unexplained-text-truncation | 贵州茅台 | [image](artifacts/1280-_stocks.png) |
| P2 | /stocks / 1280 | unexplained-text-truncation | 上证指数 +0.50% | [image](artifacts/1280-_stocks.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|tab\|关注股票\|\|0 | [image](artifacts/1024-_stocks.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|tab\|条件选股\|\|0 | [image](artifacts/1024-_stocks.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|tab\|风险证据\|\|0 | [image](artifacts/1024-_stocks.png) |
| P1 | /stocks / 1024 | control-occluded | BUTTON\|tab\|交易日简报\|\|0 | [image](artifacts/1024-_stocks.png) |
| P1 | /stocks / 1024 | control-overlap | BUTTON\|\|选择参考资料\|\|0 / BUTTON\|tab\|关注股票\|\|0 | [image](artifacts/1024-_stocks.png) |

## Coverage gaps

- Filtered run: not full release acceptance
- Screens-only exploration: controls not exercised

## Page and control coverage

| Route | Width | Total | Passed / shared / disabled / protocol / uncovered / failed | Screenshot |
| --- | --- | --- | --- | --- | --- |
| /schedule | 1440 | 0 | 0 / 0 / 0 / 0 / 0 / 0 | [image](artifacts/1440-_schedule.png) |
| /skills | 1440 | 0 | 0 / 0 / 0 / 0 / 0 / 0 | [image](artifacts/1440-_skills.png) |
| /stocks | 1440 | 0 | 0 / 0 / 0 / 0 / 0 / 0 | [image](artifacts/1440-_stocks.png) |
| /schedule | 1280 | 0 | 0 / 0 / 0 / 0 / 0 / 0 | [image](artifacts/1280-_schedule.png) |
| /skills | 1280 | 0 | 0 / 0 / 0 / 0 / 0 / 0 | [image](artifacts/1280-_skills.png) |
| /stocks | 1280 | 0 | 0 / 0 / 0 / 0 / 0 / 0 | [image](artifacts/1280-_stocks.png) |
| /schedule | 1024 | 0 | 0 / 0 / 0 / 0 / 0 / 0 | [image](artifacts/1024-_schedule.png) |
| /skills | 1024 | 0 | 0 / 0 / 0 / 0 / 0 / 0 | [image](artifacts/1024-_skills.png) |
| /stocks | 1024 | 0 | 0 / 0 / 0 / 0 / 0 / 0 | [image](artifacts/1024-_stocks.png) |

## Boundary and exclusions

- 403 /api/trpc/videoEditing.getProject on /video/edit/:projectId: Actual backend default-off contract: FORBIDDEN; no license or remote SDK is provisioned
- synthetic external popup landing: URL navigation tested through local HTML interception; third-party availability is not tested
- exact five brand PNG assets: offline SVG placeholder preserves box geometry; logo pixel fidelity is excluded

Disabled controls are recorded as prerequisites, not successful actions. Static source inventory is broader than the finite runtime states. Missing runtime contracts, traversal limits and unknown routes block the gate. See README.md and known-issues.md for the interpretation of this baseline.
