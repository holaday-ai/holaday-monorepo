# UI regression report

Result: **failed** · candidate `937bad5686abde39ada1fca6744b51b5edf43215` · seed `2026-10-09-v2`

Frontend source: `8688387293788bf2dcf7eacf7c7a0de7445f2a7770ebabdfcf00cf184ec1ca20`; build: `a694f7008e4ebab1424d2aa8fbdf70ddf685fe554dcedd57d5e5c662c717ce8a`.

Local seeded frontend/backend only. Production, paid services and real accounts are not contacted. Baseline creation is not a passed comparison.

Pages: 10/10; findings: 2; coverage gaps: 2.

## Findings

| Severity | Route / width | Rule | Detail | Screenshot |
| --- | --- | --- | --- | --- |
| P2 | task:browser:executing / 1280 | unexplained-truncation | BUTTON\|\|UI generate awaiting_us…\|\|0 | [image](artifacts/1280-task_browser_executing-control-161.png) |
| P2 | task:browser:executing / 1024 | unexplained-truncation | BUTTON\|\|UI generate awaiting_us…\|\|0 | [image](artifacts/1024-task_browser_executing-control-159.png) |

## Coverage gaps

- Filtered run: not full release acceptance
- Case-filtered run: not full release acceptance

## Page and control coverage

| Route | Width | Total | Passed / shared / disabled / protocol / uncovered / failed | Screenshot |
| --- | --- | --- | --- | --- | --- |
| task:browser:executing | 1280 | 256 | 219 / 21 / 16 / 0 / 0 / 0 | [image](artifacts/1280-task_browser_executing.png) |
| task:browser:completed | 1280 | 124 | 73 / 45 / 6 / 0 / 0 / 0 | [image](artifacts/1280-task_browser_completed.png) |
| task:browser:failed | 1280 | 93 | 50 / 37 / 6 / 0 / 0 / 0 | [image](artifacts/1280-task_browser_failed.png) |
| task:browser:awaiting_user | 1280 | 83 | 34 / 39 / 10 / 0 / 0 / 0 | [image](artifacts/1280-task_browser_awaiting_user.png) |
| task:browser:cancelled | 1280 | 92 | 47 / 39 / 6 / 0 / 0 / 0 | [image](artifacts/1280-task_browser_cancelled.png) |
| task:browser:executing | 1024 | 254 | 217 / 21 / 16 / 0 / 0 / 0 | [image](artifacts/1024-task_browser_executing.png) |
| task:browser:completed | 1024 | 122 | 71 / 45 / 6 / 0 / 0 / 0 | [image](artifacts/1024-task_browser_completed.png) |
| task:browser:failed | 1024 | 91 | 48 / 37 / 6 / 0 / 0 / 0 | [image](artifacts/1024-task_browser_failed.png) |
| task:browser:awaiting_user | 1024 | 81 | 32 / 39 / 10 / 0 / 0 / 0 | [image](artifacts/1024-task_browser_awaiting_user.png) |
| task:browser:cancelled | 1024 | 90 | 45 / 39 / 6 / 0 / 0 / 0 | [image](artifacts/1024-task_browser_cancelled.png) |

## Boundary and exclusions

- 403 /api/trpc/videoEditing.getProject on /video/edit/:projectId: Actual backend default-off contract: FORBIDDEN; no license or remote SDK is provisioned
- synthetic external popup landing: URL navigation tested through local HTML interception; third-party availability is not tested
- exact five brand PNG assets: offline SVG placeholder preserves box geometry; logo pixel fidelity is excluded

Disabled controls are recorded as prerequisites, not successful actions. Static source inventory is broader than the finite runtime states. Missing runtime contracts, traversal limits and unknown routes block the gate. See README.md and known-issues.md for the interpretation of this baseline.
