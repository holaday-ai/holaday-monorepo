import { z } from 'zod';
import { browserControlSessions } from '../agent/supercar/browser-control-sessions.js';
import type { BrowserInstance } from '../browser-pool/types.js';
import { instanceBrowserCapabilities } from '../config/browser-capabilities.js';

const activity = z
  .object({
    type: z.literal('activity'),
    keys: z.number().int().min(0).max(64),
    pointers: z.number().int().min(0).max(3),
    composing: z.boolean(),
  })
  .strict();
interface OwnedViewer {
  instance: BrowserInstance;
  source: object;
  peek(taskId: string): BrowserInstance | null;
}
/** Authenticated screen metadata, never page content or a new browser action. */
export function acceptViewerActivity(raw: string, viewer: OwnedViewer): boolean {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!value || typeof value !== 'object' || !('type' in value) || value.type !== 'activity')
    return false;
  if (!instanceBrowserCapabilities(viewer.instance).collaborationV2) return true;
  const parsed = activity.safeParse(value);
  if (
    !parsed.success ||
    viewer.peek(viewer.instance.taskId) !== viewer.instance ||
    viewer.instance.status !== 'ready'
  )
    return true;
  browserControlSessions.noteViewerActivity(viewer.instance, viewer.source, parsed.data);
  return true;
}

/** Losing a held gesture is not a key-up receipt. Await a physical browser stop, never replay it. */
export async function finishViewerActivity(
  viewer: OwnedViewer & { stop(): Promise<boolean> },
): Promise<void> {
  if (
    viewer.peek(viewer.instance.taskId) !== viewer.instance ||
    !browserControlSessions.viewerHasHeldInput(viewer.instance, viewer.source)
  )
    return;
  await browserControlSessions.quarantine(viewer.instance, viewer.stop);
}
