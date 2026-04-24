# infra/

Canonical copies of the pm2 wrapper scripts that live under
`/opt/holaday-*/start.sh` on the VULTR host. Kept here so a rebuilt
box (or a new lane) can reproduce the exact flags that have been
iterated into production.

## Contents

| File | Deployed at | pm2 name |
|---|---|---|
| `holaday-chromium-headed-start.sh` | `/opt/holaday-headed/start.sh` | `holaday-chromium-headed` |
| `holaday-vnc-start.sh` | `/opt/holaday-vnc/start.sh` | `holaday-vnc` |

## Drift rule

These files are **not the source of truth at runtime** — the server
copies are. When you change something on the server, mirror the
change here in the same commit so the git log has a record of the
current canonical flags. Otherwise the next rebuild will lose
whatever was tuned in place.

## Why these two need supervisor loops

**`holaday-vnc-start.sh`** runs x11vnc 0.9.16 (last upstream 2019)
which crashes with SIGSEGV every few hours of idle. pm2 sees the
wrapper script as alive (because websockify keeps it alive) and
never restarts. The `while true` loops around both x11vnc and
websockify let the wrapper supervise them independently; if either
dies the loop restarts it in 2s.

**`holaday-chromium-headed-start.sh`** launches Brave in kiosk mode
on Xvfb :98 with a suite of chrome-UI suppression flags +
no-backgrounding flags + `xdotool` post-launch geometry enforcement.
The Preferences JSON pre-seed covers Brave's welcome banner / P3A
notice on a fresh profile.

## Adjacent policy file

`/etc/brave/policies/managed/holaday.json` (NOT in this repo — too
host-specific) sets `CommandLineFlagSecurityWarningsEnabled: false`
to kill the yellow `--no-sandbox` infobar plus a suite of
`BraveRewardsDisabled / BraveWalletDisabled / BraveVPNDisabled /
BraveAIChatEnabled:false / MetricsReportingEnabled:false /
SafeBrowsingProtectionLevel:0`. See commit history for the exact
fields.
