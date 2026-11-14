import type { Page } from 'playwright';

/**
 * G2e: a page shaped like Cloudflare's security check (「Performing security verification … Verify
 * you are human」): the Turnstile iframe lives inside a CLOSED shadow root, so
 * document.querySelectorAll('iframe') never sees it. Tests only — served on a fixture address and
 * challenges.cloudflare.com is routed to a local body (nothing leaves the machine).
 */
export const CLOUDFLARE_CHALLENGE = `<!doctype html><html lang="en-US"><head><title>Just a moment...</title></head><body>
<div class="main-wrapper" role="main"><div class="main-content">
<h1 class="zone-name-title h1">www.fixture.test</h1>
<p id="Truv1" class="h2 spacer-bottom">Performing security verification</p>
<div id="challenge-stage" style="position:absolute;left:120px;top:240px">
<div id="kXpT9" style="display:grid"><div id="cf-host"><input type="hidden" name="cf-turnstile-response" id="cf-chl-widget-a1b2c_response" value=""></div></div>
</div>
<p style="position:absolute;top:400px">This website uses a security service to protect against malicious bots.</p>
</div></div>
<script>
// As challenge-platform renders it: the widget's iframe lives in a closed shadow root on the
// container that also holds the (unrendered) response input.
const host = document.getElementById('cf-host');
const root = host.attachShadow({ mode: 'closed' });
const frame = document.createElement('iframe');
frame.src = 'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/g/turnstile/if/ov2/av0/rcv/fixture/0x4AAAAAAA/light/fbE/new/normal/auto/';
frame.title = 'Widget containing a Cloudflare security challenge';
frame.style.cssText = 'border:none;overflow:hidden;width:300px;height:65px';
root.appendChild(frame);
</script></body></html>`;

/** The challenge page on a fixture address, with Cloudflare's frame routed to a local body. */
export async function cloudflareChallengePage(page: Page): Promise<void> {
  await page.route('https://www.fixture.test/', (route) =>
    route.fulfill({ contentType: 'text/html', body: CLOUDFLARE_CHALLENGE }),
  );
  await page.route('https://challenges.cloudflare.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<body style="margin:0;background:#fafafa"><label><input type="checkbox"> Verify you are human</label></body>',
    }),
  );
  await page.goto('https://www.fixture.test/');
}
