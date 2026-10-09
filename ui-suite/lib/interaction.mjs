import { classifyGeometry, measurePage } from './checks.mjs';
const fingerprint = (p) =>
  p.evaluate(() =>
    JSON.stringify({
      url: location.pathname + location.search + location.hash,
      scroll: [...document.querySelectorAll('*')]
        .filter((e) => e.scrollTop || e.scrollLeft)
        .map((e) => [e.scrollTop, e.scrollLeft]),
      fullscreen: Boolean(document.fullscreenElement),
      text: document.body.innerText,
      states: [
        ...document.querySelectorAll(
          '[aria-expanded],[aria-selected],[aria-pressed],[data-state],input,textarea,select,button,details',
        ),
      ].map((e) => [
        e.getAttribute('aria-expanded'),
        e.getAttribute('aria-selected'),
        e.getAttribute('aria-pressed'),
        e.getAttribute('data-state'),
        e.type,
        e.value,
        e.checked,
        e.className,
        e.getAttribute('style'),
        e.open,
      ]),
    }),
  );
const rowKeys = (p) =>
  p.evaluate(() =>
    [
      ...document.querySelectorAll(
        'tr,[role="row"],[role="button"],button,main a[href*="task"],main [data-task-id]',
      ),
    ].map(
      (e) => e.getAttribute('data-ui-audit-id') ?? `${e.textContent}|${e.getAttribute('href')}`,
    ),
  );
export async function observeControl(page, control, { checkDismissal = true } = {}) {
  const locator = page.locator(`[data-ui-audit-id=${JSON.stringify(control.id)}]`).first();
  if (!(await locator.count()))
    return { ...control, status: 'uncovered', reason: 'control vanished before its action' };
  if (control.disabled || (await locator.evaluate((e) => Boolean(e.readOnly))))
    return {
      ...control,
      status: 'disabled',
      reason: control.hasHint
        ? 'explained disabled control'
        : 'disabled; input or feature prerequisite',
    };
  if (
    (control.role === 'tab' && (await locator.getAttribute('aria-selected')) === 'true') ||
    control.exclusivePressed ||
    (/^选择匹配技能：/.test(control.label) &&
      (await locator.getAttribute('aria-pressed')) === 'true') ||
    (control.type === 'radio' && control.checked)
  )
    return { ...control, status: 'idempotent', reason: 'already selected option' };
  if (control.selectedWithoutSemantics)
    return {
      ...control,
      status: 'idempotent',
      reason: 'source-confirmed selected choice',
      accessibilityIssue:
        'Selected choice is styled as active but lacks aria-selected/aria-pressed',
    };
  if (control.href && new URL(control.href, page.url()).href === page.url())
    return { ...control, status: 'idempotent', reason: 'current route link' };
  if (/^(mailto:|tel:)/i.test(control.href ?? '')) {
    const u = new URL(control.href);
    return {
      ...control,
      status: u.pathname ? 'protocol-link' : 'failed',
      reason: u.pathname
        ? 'external protocol URI verified; host application not launched'
        : 'empty protocol destination',
    };
  }
  if (
    control.label === '继续今日内容' &&
    (await page.evaluate(() => {
      const target = document.querySelector('#energy-today-content');
      if (!target) return false;
      const rect = target.getBoundingClientRect();
      const margin = Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
      return (
        Math.abs(rect.top - margin) < 3 ||
        (scrollY + innerHeight >= document.documentElement.scrollHeight - 3 &&
          rect.top >= 0 &&
          rect.top < innerHeight)
      );
    }))
  )
    return {
      ...control,
      status: 'idempotent',
      reason: 'scroll target already aligned or visible at document scroll limit',
    };
  if (
    control.label === '新任务' &&
    new URL(page.url()).pathname === '/' &&
    !new URL(page.url()).search &&
    (await page.evaluate(() => {
      const composer = document.querySelector('textarea[placeholder="说说你想做的事..."]');
      const visibleBrowser = [
        ...document.querySelectorAll('section[aria-label="浏览器工作区"]'),
      ].some((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
      });
      return composer && !composer.value && !visibleBrowser;
    }))
  )
    return { ...control, status: 'idempotent', reason: 'already on empty new-task composer' };
  const overlaySelector =
    'dialog[open]:visible,[role=dialog]:visible,[role=alertdialog]:visible,[role=menu]:visible,[role=listbox]:visible';
  const overlaysBefore = await page.locator(overlaySelector).count();
  const before = await fingerprint(page);
  const rowsBefore = await rowKeys(page);
  const requests = [];
  const popups = [];
  const downloads = [];
  const onRequest = (r) => {
    if (
      r.isNavigationRequest() ||
      (new URL(r.url()).pathname.startsWith('/api/') &&
        !/\/(?:auth\.me|quota\.status|notifications\.unreadCount|tasks\.unsuccessfulCount|stream-token)$/.test(
          new URL(r.url()).pathname,
        ))
    )
      requests.push({
        path: new URL(r.url()).pathname,
        method: r.method(),
        navigation: r.isNavigationRequest(),
      });
  };
  const onPopup = (p) => popups.push(p);
  const onDownload = (d) => downloads.push(d);
  const chooserActions = [];
  const onChooser = (chooser) => {
    chooserActions.push(
      chooser.setFiles({
        name: 'ui.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0u8AAAAASUVORK5CYII=',
          'base64',
        ),
      }),
    );
  };
  page.on('filechooser', onChooser);
  page.on('request', onRequest);
  page.on('popup', onPopup);
  page.on('download', onDownload);
  try {
    const type = control.type ?? '';
    if (control.tag === 'select') {
      const options = await locator
        .locator('option')
        .evaluateAll((es) => es.filter((e) => !e.disabled).map((e) => e.value));
      const current = await locator.inputValue();
      const other = options.find((v) => v !== current);
      if (other !== undefined) await locator.selectOption(other);
      else
        return { ...control, status: 'idempotent', reason: 'only enabled option already selected' };
    } else if (
      ['input', 'textarea'].includes(control.tag) &&
      !['button', 'submit', 'checkbox', 'radio', 'file', 'range', 'color', 'hidden'].includes(type)
    ) {
      const values = {
        email: 'ui@example.test',
        number: '3',
        tel: '13800000000',
        date: '2026-10-09',
        time: '10:30',
        'datetime-local': '2026-10-09T10:30',
        password: 'Local-test-password-123',
        url: 'https://example.com',
      };
      const numeric =
        /验证码|6 位|6位/.test(control.label) ||
        (await locator.getAttribute('inputmode')) === 'numeric';
      await locator.fill(values[type] ?? (numeric ? '123456' : 'UI audit'));
    } else if (type === 'range') await locator.press('ArrowRight');
    else if (type === 'color') await locator.fill('#123456');
    else if (type === 'file') {
      const image = ((await locator.getAttribute('accept')) ?? '').includes('image');
      await locator.setInputFiles({
        name: image ? 'ui.png' : 'ui.txt',
        mimeType: image ? 'image/png' : 'text/plain',
        buffer: image
          ? Buffer.from(
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0u8AAAAASUVORK5CYII=',
              'base64',
            )
          : Buffer.from('local UI seed'),
      });
    } else await locator.click({ timeout: 1800 });
    await Promise.all(chooserActions);
    let changed = false;
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(75);
      if (
        (await fingerprint(page).catch(() => before)) !== before ||
        popups.length ||
        downloads.length ||
        chooserActions.length ||
        requests.length
      ) {
        changed = true;
        break;
      }
    }
    // The task specification permits a relevant request as an observable effect; polling is excluded.
    const popupUrls = [];
    for (const popup of popups) {
      try {
        await popup.waitForURL((u) => u.toString() !== 'about:blank', { timeout: 1800 });
        popupUrls.push(popup.url());
      } catch {
        popupUrls.push('about:blank');
      } finally {
        await popup.close();
      }
    }
    if (popupUrls.includes('about:blank'))
      return {
        ...control,
        status: 'failed',
        reason: 'popup remains about:blank',
        requests,
        popupUrls,
      };
    const expectedPopup = /^https?:/.test(control.href ?? '')
      ? new URL(control.href, page.url()).href
      : null;
    if (popupUrls.some((url) => !/^https?:/.test(url) || (expectedPopup && url !== expectedPopup)))
      return {
        ...control,
        status: 'failed',
        reason: 'popup did not reach requested URL',
        requests,
        popupUrls,
      };
    await page.evaluate(async () => {
      const animations = document
        .getAnimations()
        .filter(
          (a) =>
            a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime),
        );
      await Promise.race([
        Promise.all(animations.map((a) => a.finished.catch(() => {}))),
        new Promise((resolve) => setTimeout(resolve, 800)),
      ]);
    });
    // Allow documented 200 ms UI debounce (reference library) to finish before replay discovery.
    await page.waitForTimeout(250);
    const afterUrl = page.url();
    let dismissal;
    let replayAfterDismissal = false;
    if (
      checkDismissal &&
      (await locator.count()) &&
      control.expanded === 'false' &&
      (await locator.getAttribute('aria-expanded')) === 'true'
    ) {
      const popup =
        Boolean(await locator.getAttribute('aria-haspopup')) ||
        (await page
          .locator(
            'dialog[open]:visible,[role="menu"]:visible,[role="dialog"]:visible,[role="listbox"]:visible',
          )
          .count()) > 0;
      await locator.click({ timeout: 1800 }).catch(() => {});
      await page.waitForTimeout(60);
      const closed = async () =>
        !(await locator.count()) || (await locator.getAttribute('aria-expanded')) === 'false';
      const secondClick = await closed();
      if (secondClick && (await locator.count())) await locator.click({ timeout: 1800 });
      let escapeClosed;
      if (popup) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(60);
        escapeClosed = await closed();
      }
      dismissal = { secondClick, escape: escapeClosed, kind: popup ? 'popup' : 'inline' };
      if (!secondClick && !escapeClosed)
        return {
          ...control,
          status: 'failed',
          reason: 'expanded control cannot dismiss by second click or Escape',
          dismissal,
          requests,
          afterUrl,
        };
      // Leave the region open so that its nested controls are inspected.
      if ((await locator.count()) && (await locator.getAttribute('aria-expanded')) !== 'true')
        await locator.click({ timeout: 1800 });
      await page.waitForTimeout(60);
    }
    if (
      checkDismissal &&
      !dismissal &&
      page.url() === afterUrl &&
      (await page.locator(overlaySelector).count()) > overlaysBefore
    ) {
      await page.keyboard.press('Escape');
      let escapeClosed = false;
      for (let n = 0; n < 16; n++) {
        await page.waitForTimeout(50);
        if ((await page.locator(overlaySelector).count()) <= overlaysBefore) {
          escapeClosed = true;
          break;
        }
      }
      dismissal = { kind: 'popup', escape: escapeClosed };
      if (!escapeClosed)
        return {
          ...control,
          status: 'failed',
          reason: 'opened popup cannot dismiss with Escape',
          dismissal,
          requests,
          afterUrl,
        };
      replayAfterDismissal = true;
    }
    if (/加载更多|查看更多|load more/i.test(control.label)) {
      await page.waitForTimeout(250);
      const rowsAfter = await rowKeys(page);
      const appended = rowsAfter.some((x) => !rowsBefore.includes(x));
      const _textAfter = await fingerprint(page);
      if (!appended && rowsBefore.length)
        return {
          ...control,
          status: 'failed',
          reason: 'load more did not append distinct rows',
          requests,
          afterUrl,
        };
      if (!appended)
        return {
          ...control,
          status: 'uncovered',
          reason: 'pagination has no stable row identity; add a page-specific assertion',
          requests,
          afterUrl,
        };
    }
    return {
      ...control,
      status: changed ? 'passed' : 'failed',
      reason: changed
        ? 'observable state, route, input, request or download'
        : 'no observable effect',
      requests,
      popupUrls,
      downloads: downloads.map((d) => d.suggestedFilename()),
      dismissal,
      replayAfterDismissal,
      afterUrl,
    };
  } catch (error) {
    return {
      ...control,
      status: 'failed',
      reason: String(error.message).split('\n')[0].slice(0, 220),
    };
  } finally {
    page.off('request', onRequest);
    page.off('popup', onPopup);
    page.off('download', onDownload);
    page.off('filechooser', onChooser);
  }
}
function matchingControl(elements, wanted) {
  const exact = elements.find((x) => x.id === wanted.id);
  if (exact) return exact;
  const equivalent = elements.filter(
    (x) =>
      x.tag === wanted.tag &&
      x.role === wanted.role &&
      x.scope === wanted.scope &&
      x.label === wanted.label &&
      x.href === wanted.href,
  );
  return equivalent.length === 1 ? equivalent[0] : undefined;
}
export async function inspectControls(
  page,
  { reset, shared = new Map(), maxDepth = 20, onEvidence = async () => {}, maxControls = 400 } = {},
) {
  const initial = await measurePage(page);
  const results = [];
  const queue = initial.elements
    .filter((c) => !c.intentionalOverlay)
    .map((control) => ({ control, path: [] }));
  const seen = new Set();
  const outcomes = new Map();
  const repeatReferences = new Map();
  const reportedRepeatIds = new Set();
  const invalidPaths = [];
  while (queue.length) {
    if (results.length >= maxControls) {
      results.push({
        status: 'uncovered',
        reason: `bounded traversal limit ${maxControls}; ${queue.length} queued controls remain`,
      });
      break;
    }
    const { control, path } = queue.shift();
    const key = JSON.stringify([control.scope, control.repeatFamilyKey ?? control.id]);
    if (seen.has(key) && !(outcomes.get(key) === 'disabled' && path.length)) {
      if (control.repeatFamilyKey && !reportedRepeatIds.has(control.id)) {
        results.push({
          ...control,
          status: 'shared-reference',
          reference: repeatReferences.get(key),
          referencedStatus: outcomes.get(key),
          reason: 'same batch clone action already exercised on first and second rows',
        });
        reportedRepeatIds.add(control.id);
      }
      continue;
    }
    seen.add(key);
    if (control.repeatFamilyKey) {
      repeatReferences.set(key, control.id);
      reportedRepeatIds.add(control.id);
    }
    const isShared = control.shared || path[0]?.shared;
    if (isShared && shared.has(key)) {
      results.push({ ...control, status: 'shared-reference', ...shared.get(key) });
      continue;
    }
    const pathIds = path.map((x) => x.id);
    const blocked = invalidPaths.find((x) => x.ids.every((id, i) => id === pathIds[i]));
    if (blocked) {
      results.push({
        ...control,
        path: pathIds,
        status: 'uncovered',
        reason: `ancestor replay failed: ${blocked.reason}`,
      });
      continue;
    }
    let replayFailure;
    if (reset) {
      await reset();
      for (let i = 0; i < path.length; i++) {
        const step = path[i];
        const m = await measurePage(page);
        const next = matchingControl(m.elements, step);
        const result = next
          ? await observeControl(page, next, { checkDismissal: false })
          : { status: 'uncovered', reason: 'ancestor control absent' };
        if (page.url() !== initial.url) {
          replayFailure = `${step.label}: replay navigated away from the scenario`;
          invalidPaths.push({ ids: pathIds.slice(0, i + 1), reason: replayFailure });
          break;
        }
        if (!['passed', 'idempotent', 'protocol-link'].includes(result.status)) {
          replayFailure = `${step.label}: ${result.reason}`;
          invalidPaths.push({ ids: pathIds.slice(0, i + 1), reason: replayFailure });
          break;
        }
      }
    }
    if (replayFailure) {
      results.push({
        ...control,
        path: pathIds,
        status: 'uncovered',
        reason: `ancestor replay failed: ${replayFailure}`,
      });
      continue;
    }
    const current = await measurePage(page);
    const candidate = matchingControl(current.elements, control);
    if (!candidate) {
      results.push({
        ...control,
        path: path.map((x) => x.id),
        status: 'uncovered',
        reason: 'not reproducible after reset',
      });
      continue;
    }
    const result = await observeControl(page, candidate);
    if (results.length % 25 === 0)
      console.log(
        JSON.stringify({
          phase: 'controls',
          done: results.length,
          queued: queue.length,
          url: new URL(page.url()).pathname,
        }),
      );
    result.path = path.map((x) => x.id);
    if (result.replayAfterDismissal) {
      if (!reset) {
        result.status = 'uncovered';
        result.reason = 'popup children need a clean reset and replay';
      } else {
        await reset();
        for (const step of [...path, control]) {
          const next = matchingControl((await measurePage(page)).elements, step);
          const restored = next
            ? await observeControl(page, next, { checkDismissal: false })
            : { status: 'uncovered', reason: 'control absent' };
          if (
            !['passed', 'idempotent', 'protocol-link'].includes(restored.status) ||
            page.url() !== initial.url
          ) {
            result.status = 'uncovered';
            result.reason = `popup restore failed: ${step.label}: ${restored.reason}`;
            break;
          }
        }
      }
    }
    const layout = await measurePage(page);
    if (result.status === 'passed' && current.url === layout.url)
      result.layout = classifyGeometry(layout.elements, layout.width, layout.height);
    if (result.status === 'failed' || result.layout?.length)
      result.screenshot = await onEvidence(results.length);
    results.push(result);
    outcomes.set(key, result.status);
    if (isShared) shared.set(key, { reference: page.url(), referencedStatus: result.status });
    if (
      result.status === 'passed' &&
      current.url === result.afterUrl &&
      current.url === layout.url
    ) {
      const beforeById = new Map(current.elements.map((x) => [x.id, x]));
      const added = layout.elements.filter(
        (x) =>
          !x.intentionalOverlay &&
          (!beforeById.has(x.id) ||
            (beforeById.get(x.id).disabled && !x.disabled) ||
            (beforeById.get(x.id).intentionalOverlay && !x.intentionalOverlay)) &&
          (!seen.has(JSON.stringify([x.scope, x.id])) ||
            outcomes.get(JSON.stringify([x.scope, x.id])) === 'disabled'),
      );
      if (path.length < maxDepth)
        for (const child of added) queue.push({ control: child, path: [...path, control] });
      else if (added.length)
        results.push({
          id: control.id,
          status: 'uncovered',
          reason: 'nested control depth exceeds declared coverage',
          count: added.length,
        });
    }
  }
  return results;
}
