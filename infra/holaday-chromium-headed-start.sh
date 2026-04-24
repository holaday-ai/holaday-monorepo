#!/bin/bash
# Phase 9c: 1720x1440 Xvfb + kiosk Brave + no openbox decorations.
# Wholesale rewrite to match the Phase 9c requirements list.
set -e

export DISPLAY=:98

# Xvfb at 1720x1440 — taller / less wide than the 1920x1080 default
# so the panel's natural aspect fits a typical page without
# horizontal cropping when the user shrinks the panel.
if ! pgrep -f "Xvfb :98" >/dev/null 2>&1; then
  Xvfb :98 -screen 0 1720x1440x24 -nolisten tcp &
  sleep 2
fi

# Minimal WM with NO window decorations. Matchbox supports that
# natively; openbox needs an rc.xml override. We have openbox
# installed, so ship an rc.xml that turns off decor + titlebars.
#
# ~/.config/openbox/rc.xml gets read by openbox --replace.
mkdir -p /root/.config/openbox
cat > /root/.config/openbox/rc.xml <<'RCXML'
<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/3.4/rc">
  <applications>
    <!-- Apply to every app openbox sees: no decorations, no
         titlebar, position at (0,0), full screen. Matches the
         VNC-streamed-browser use case where we don't want any WM
         chrome eating viewport space. -->
    <application name="*">
      <decor>no</decor>
      <maximized>true</maximized>
      <position force="yes"><x>0</x><y>0</y></position>
    </application>
  </applications>
</openbox_config>
RCXML

pkill -f "openbox --replace" 2>/dev/null || true
sleep 1
openbox --replace --sm-disable &
sleep 1

# Clean slate before Brave launches.
pkill -f holaday-headed-brave 2>/dev/null || true
sleep 1
rm -rf /var/lib/holaday-headed-brave/Default/Sessions 2>/dev/null || true
rm -f /var/lib/holaday-headed-brave/Singleton* 2>/dev/null || true

# Pre-seed Preferences so Brave doesn't show its first-run blurbs
# the very first time a profile is created. Idempotent — if the
# Preferences file already exists we don't overwrite.
mkdir -p /var/lib/holaday-headed-brave/Default
if [ ! -f /var/lib/holaday-headed-brave/Default/Preferences ]; then
  cat > /var/lib/holaday-headed-brave/Default/Preferences <<'PREFS'
{
  "brave": {
    "rewards": {"enabled": false},
    "ai_chat": {"show_in_omnibox": false, "opted_in": false},
    "stats": {"reporting_enabled": false},
    "new_tab_page": {"show_branded_background_image": false}
  },
  "bookmark_bar": {"show_on_all_tabs": false},
  "browser": {"has_seen_welcome_page": true},
  "distribution": {"import_bookmarks": false, "make_chrome_default_for_user": false}
}
PREFS
fi

# Kiosk mode: no tab bar, no omnibar, no menu, fullscreen. The
# chrome security warnings about --no-sandbox are also suppressed
# under kiosk because kiosk swallows the infobar.
/usr/bin/brave-browser \
  --remote-debugging-port=9223 \
  --remote-debugging-address=127.0.0.1 \
  --user-data-dir=/var/lib/holaday-headed-brave \
  --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding \
  --disable-background-timer-throttling \
  --disable-features=CalculateNativeWinOcclusion \
  --no-first-run \
  --no-default-browser-check \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-infobars \
  --hide-crash-restore-bubble \
  --disable-session-crashed-bubble \
  --disable-restore-session-state \
  --disable-features=ChromeWhatsNewUI,InfiniteSessionRestore,Translate,BravePrivateProductAnalytics,BraveWelcomePage,BraveRewards,BraveAIChat,BraveTalk,BraveVPN,ImportData,BraveNTPBrandedWallpaper \
  --disable-background-networking \
  --disable-sync \
  --disable-translate \
  --lang=zh-CN \
  --window-size=1720,1440 \
  --window-position=0,0 \
  --kiosk \
  --start-fullscreen \
  about:blank &
BRAVE_PID=$!

# Post-launch fallback: force window to 1720x1440 at (0,0) and
# strip decorations via xdotool. Redundant with openbox rc.xml
# above, but cheap insurance against any window Brave spawns that
# bypasses the openbox application rule.
(
  for i in 1 2 3 4 5; do
    sleep 2
    WID=$(xdotool search --name -i brave 2>/dev/null | head -1)
    if [ -n "$WID" ]; then
      xdotool windowsize "$WID" 1720 1440 >/dev/null 2>&1 || true
      xdotool windowmove "$WID" 0 0 >/dev/null 2>&1 || true
      xdotool windowactivate "$WID" >/dev/null 2>&1 || true
      break
    fi
  done
) &

wait $BRAVE_PID
