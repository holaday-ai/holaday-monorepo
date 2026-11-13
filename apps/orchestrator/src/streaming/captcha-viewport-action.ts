import { createHash } from 'node:crypto';
import type { BrowserActionDecision, BrowserActionRequest } from '@holaday/shared-types';
import type { CDPSession } from 'playwright';
import { browserControlSessions } from '../agent/supercar/browser-control-sessions.js';
import { captchaHandoffs } from '../agent/supercar/captcha-handoff.js';
import type { BrowserInstance } from '../browser-pool/types.js';
import type { InputEnvelope } from './screencast-input-bridge.js';

/**
 * Manual-input grant for the task owner's input on this task's browser. FIX-61 P0: this used to
 * require an active CAPTCHA hand-off, so every other input was silently refused. REBUILD-4: no lease —
 * the grant is bound to the task's open control, the current observation and the target node; AI
 * input never passes here.
 */
export async function authorizeHumanViewportInput(
  instance: BrowserInstance,
  envelope: InputEnvelope,
  signal?: AbortSignal,
  session?: CDPSession | null,
): Promise<{ request: BrowserActionRequest; decision: BrowserActionDecision }> {
  const requireOwner = () => {
    signal?.throwIfAborted();
    const session = browserControlSessions.get(instance, instance.userId, instance.taskId);
    const state = session?.control.snapshot();
    // REBUILD-4: no lease — the task's open control (the transport already checked the viewer is
    // the task's owner) and the frame the person saw.
    if (
      instance.status !== 'ready' ||
      !session ||
      state?.phase !== 'agent' ||
      !envelope.observation ||
      !envelope.payload
    )
      throw new Error('browser_control_not_owned');
  };
  requireOwner();
  const page = await instance.executor.getPage();
  const cdp = session ?? (await page.context().newCDPSession(page));
  let focusedObject: string | undefined;
  try {
    const payload = envelope.payload!;
    // Bind the digest to the live DOM object, including cross-origin frame nodes.
    // Never persist input text, attributes, credentials or DOM content.
    let target: string;
    if ('x' in payload && 'y' in payload) {
      const node = await cdp.send('DOM.getNodeForLocation', {
        x: Math.round(payload.x),
        y: Math.round(payload.y),
        includeUserAgentShadowDOM: true,
      });
      target = `${node.frameId}:${node.backendNodeId}`;
    } else {
      const focus = await cdp.send('Runtime.evaluate', {
        expression: 'document.activeElement',
        returnByValue: false,
      });
      focusedObject = focus.result.objectId;
      if (!focusedObject) throw new Error('captcha_input_target_unavailable');
      const { node } = await cdp.send('DOM.describeNode', { objectId: focusedObject });
      target = String(node.backendNodeId);
    }
    requireOwner();
    const binding = browserControlSessions.get(instance, instance.userId, instance.taskId);
    const captcha =
      binding !== null && captchaHandoffs.active(instance.taskId, instance.userId, binding.control);
    return {
      request: {
        taskId: instance.taskId,
        runId: `${captcha ? 'captcha' : 'takeover'}:${instance.taskId}`,
        actor: 'human',
        lane: 'cdp',
        tabId: envelope.observation!.tabId,
        origin: new URL(page.url()).origin,
        observationRevision: envelope.observation!.viewportRevision,
        actionDigest: createHash('sha256')
          .update(JSON.stringify([target, envelope.observation, payload]))
          .digest('hex'),
      },
      // The person's own input on the task's open control. This grants no AI input and ends
      // when the task's run is stopped or the browser session changes.
      decision: { kind: 'allow', sensitive: false },
    };
  } finally {
    if (focusedObject)
      await cdp.send('Runtime.releaseObject', { objectId: focusedObject }).catch(() => {});
    if (!session) await cdp.detach().catch(() => {});
  }
}

/** Kept for the e2e scripts that still import the old name. */
export const authorizeCaptchaViewportInput = authorizeHumanViewportInput;
