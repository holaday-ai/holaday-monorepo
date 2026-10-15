import { createHash } from 'node:crypto';
import type { BrowserActionDecision, BrowserActionRequest } from '@holaday/shared-types';
import type { CDPSession } from 'playwright';
import { browserControlSessions } from '../agent/supercar/browser-control-sessions.js';
import { captchaHandoffs } from '../agent/supercar/captcha-handoff.js';
import type { BrowserInstance } from '../browser-pool/types.js';
import type { InputEnvelope } from './screencast-input-bridge.js';

/** Narrow manual-input grant. Other V2 writes keep their existing fail-closed policy. */
export async function authorizeCaptchaViewportInput(
  instance: BrowserInstance,
  envelope: InputEnvelope,
  signal?: AbortSignal,
  session?: CDPSession | null,
): Promise<{ request: BrowserActionRequest; decision: BrowserActionDecision }> {
  const requireOwner = () => {
    signal?.throwIfAborted();
    const session = browserControlSessions.get(instance, instance.userId, instance.taskId);
    const state = session?.control.snapshot();
    if (
      instance.status !== 'ready' ||
      !session ||
      state?.phase !== 'human' ||
      !envelope.controlLease ||
      state.lease !== envelope.controlLease ||
      !captchaHandoffs.active(instance.taskId, instance.userId, session.control) ||
      !envelope.observation ||
      !envelope.payload
    )
      throw new Error('captcha_control_not_owned');
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
    return {
      request: {
        taskId: instance.taskId,
        runId: `captcha:${instance.taskId}`,
        actor: 'human',
        lane: 'cdp',
        tabId: envelope.observation!.tabId,
        origin: new URL(page.url()).origin,
        observationRevision: envelope.observation!.viewportRevision,
        actionDigest: createHash('sha256')
          .update(JSON.stringify([target, envelope.observation, payload]))
          .digest('hex'),
        lease: envelope.controlLease!,
      },
      // The human controls this lease explicitly. This grants no AI input and
      // is revoked immediately when the handoff resumes, ends or times out.
      decision: { kind: 'allow', sensitive: false },
    };
  } finally {
    if (focusedObject)
      await cdp.send('Runtime.releaseObject', { objectId: focusedObject }).catch(() => {});
    if (!session) await cdp.detach().catch(() => {});
  }
}
