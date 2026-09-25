import type { SelectedChromeSessionCommand, ServerMessage } from './ws.js';

const selector = {
  description: 'Save',
  strategies: [{ kind: 'role' as const, role: 'button', name: 'Save' }],
  scope: { timeoutMs: 5_000 },
  selfHeal: false,
};

const command: SelectedChromeSessionCommand = {
  op: 'act',
  sessionId: 'c4860f52-6b76-4d18-a6ba-04165322af7d',
  action: { kind: 'click', selector, deadlineMs: 5_000 },
};

export const selectedChromeSessionMessage = {
  type: 'server.extension.tool_call',
  taskId: 'task-a',
  requestId: 'request-a',
  kind: 'session',
  args: { session: command },
  timeoutMs: 30_000,
} satisfies ServerMessage;

const evalCommand: SelectedChromeSessionCommand = {
  op: 'act',
  sessionId: 'c4860f52-6b76-4d18-a6ba-04165322af7d',
  // @ts-expect-error selected Chrome never exposes arbitrary evaluation.
  action: { kind: 'eval', payload: { expression: 'location.href' } },
};

void evalCommand;
