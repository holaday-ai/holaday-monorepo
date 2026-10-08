# Browser viewport V2 (PR1)

Default off. Build the frontend with `VITE_BROWSER_VIEWPORT_V2=true` and explicitly enable backend `BROWSER_VIEWPORT_V2=true` only in local/test environments. A V2 connection is rejected when the backend flag is off. This PR does not enable either flag in production.

The visible panel owns the outer width. Default contain preserves the whole current remote viewport. Desktop rendering defaults to 1280×800 independently of portrait panel width; the caller may supply an explicit desktop profile. “按面板宽度渲染” explicitly requests a desktop (non-mobile) viewport matching the panel. Original/zoom and named pan buttons change only local display. Wheel/touch scrolling is sent to the remote page under its existing human control lease.

CDP frames carry frameId, tabId, viewportRevision, CSS/image dimensions, pageScaleFactor, offsetTop, scroll offset and capture time. Image coordinates are converted through the actual displayed canvas rectangle, divided by compositor pageScaleFactor; document scroll is not added. PointerEvents retain subpixel precision. Source pixel ratio is retained per Page across parallel CDP detach/reconnect. A resize request invalidates input immediately; only an applied resize ACK and a fresh matching frame restore it. Async image decodes cannot restore invalidated geometry. The server checks current Page identity and the existing serialized control lease checkpoint, not just client assertions.

VNC keeps noVNC’s framebuffer/display conversion and RFB resize handling. A fractional PointerEvent bridge avoids legacy MouseEvent integer rounding; CDP page scaling/scroll metadata never enters the VNC transform. V2 VNC remains server-enforced read-only: both legacy and broker relays parse client RFB 3.8/no-auth messages and reject pointer, keyboard, clipboard, resize and unknown extension messages. Unsupported authentication/protocol variants fail closed.

## Safety integration dependency

PR #248 is still open (inspected head 1596f7c4). It adds the unified runner’s onBeforeAction gate but does not expose the nonce-aware action contract required here. This PR retains a server-only `beforeViewportAction` adapter seam; no adapter is wired by the application. Therefore V2 click/type/key writes are denied. Existing lease-controlled scroll/hover observation remains available. The client receives the same write capability.

An eventual adapter must derive the live exact target, action digest, origin and run identity on the server, call #248’s onBeforeAction, and return allow/deny/awaiting_user. Task/tab/revision/actor/lane/lease are rechecked after asynchronous policy evaluation. Sensitive allow also requires a server-owned, exact-action-bound, 60-second, one-use nonce; reconnect/navigation/resize/tab replacement invalidate pending confirmations. This PR deliberately supplies no issuing endpoint. Before enabling sensitive control, implement and verify authenticated issuance, logical click/down/up grouping, object stability and effect evidence; a plaintext affirmative reply is insufficient.

## Reproducible local verification

Use Node 22 and run:

```sh
pnpm --filter @holaday/orchestrator exec tsx ../../scripts/browser-viewport-v2-acceptance.mjs
```

The harness uses actual Chromium, streamer, input handler, CDP component and BrowserPanel; no accounts, production endpoints or paid model calls. Actual noVNC is tested against a synthetic raw RFB framebuffer. Output defaults to `/private/tmp/holaday-tasks/browser-pr1`, with JSON and screenshots; set `PR1_OUT` to another scratch directory. Chromium renderer limit is 2; cases run serially.

The matrix covers 390/430/760/1440 panels, 320/430/1280/1600 source widths, verified actual DPR 1/2, page-content CSS zoom 80/100/125/200%, compositor pinch scale 125/200%, original/local zoom/pan, explicit panel rendering, iframe, fixed overlay and Chinese composition. Native browser chrome zoom at 80% is not claimed by these CSS-zoom tests. A real BrowserPanel portrait assertion checks whole-frame bounds and equal client/scroll widths. VNC pointer precision is isolated in a local fixture; application V2 VNC writes remain disabled.

Unit and real-proxy tests cover stale/forged frames, nonce mismatch/replay/expiry/clock rollback, queued input invalidation, resize requests, missing/throwing policy and sensitive writes without nonce. These are local/component results, not deployment or real-user acceptance.
