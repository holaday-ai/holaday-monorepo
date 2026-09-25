import net from 'node:net';
import { isAbsolute } from 'node:path';

const codes = new Set(['INVALID_COMMAND', 'IDENTITY_MISMATCH', 'COMMAND_REJECTED', 'READ_TIMEOUT']);
const kinds = ['request', 'execution', 'suggestions', 'database', 'model', 'scheduler'];
function checkedSnapshot(value, identity) {
  if (
    !value ||
    value.identity?.candidate !== identity.candidate ||
    value.identity?.bootId !== identity.bootId ||
    !['closed', 'draining', 'serving', 'blocked'].includes(value.mode) ||
    typeof value.needsReconciliation !== 'boolean'
  )
    throw new Error();
  const c = value.counts;
  const integer = (v) => Number.isSafeInteger(v) && v >= 0 && v <= 65536;
  if (
    !c ||
    !['open', 'closed', 'blocked'].includes(c.mode) ||
    typeof c.idle !== 'boolean' ||
    ![c.active, c.roots, c.children, c.unknown, ...kinds.map((k) => c.byKind?.[k])].every(
      integer,
    ) ||
    c.active !== c.roots + c.children ||
    kinds.reduce((sum, k) => sum + c.byKind[k], 0) !== c.active ||
    c.idle !== (c.mode === 'closed' && c.active === 0 && c.unknown === 0) ||
    (value.mode === 'serving' && (c.mode !== 'open' || !value.needsReconciliation)) ||
    (value.mode === 'blocked' && (c.mode !== 'blocked' || !value.needsReconciliation)) ||
    (value.mode === 'closed' && !c.idle) ||
    (value.mode === 'draining' && c.mode !== 'closed')
  )
    throw new Error();
  return value;
}

/** One bounded request, no retries or implicit initialization/open. */
export async function requestMaintenance({ socketPath, identity, op, timeoutMs = 5000 }) {
  if (
    typeof socketPath !== 'string' ||
    !isAbsolute(socketPath) ||
    Buffer.byteLength(socketPath) > 100 ||
    !/^[a-f0-9]{40}$/.test(identity?.candidate) ||
    !/^[a-f0-9]{32}$/.test(identity?.bootId) ||
    !['status', 'close', 'wait', 'open'].includes(op) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 600000
  ) {
    throw new Error('MAINTENANCE_CLIENT_INPUT');
  }
  const command = {
    protocol: 1,
    candidate: identity.candidate,
    bootId: identity.bootId,
    op,
    ...(op === 'wait' ? { timeoutMs } : {}),
  };
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = Buffer.alloc(0);
    let done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    // wait needs a bounded transport allowance beyond the server-side drain deadline.
    const timer = setTimeout(
      () => finish(new Error('MAINTENANCE_CLIENT_TIMEOUT')),
      timeoutMs + (op === 'wait' ? 1000 : 0),
    );
    socket.on('connect', () => socket.write(`${JSON.stringify(command)}\n`));
    socket.on('error', () => finish(new Error('MAINTENANCE_CLIENT_UNAVAILABLE')));
    socket.on('close', () => finish(new Error('MAINTENANCE_CLIENT_PROTOCOL')));
    socket.on('data', (bytes) => {
      if (buffer.length + bytes.length > 4096) {
        finish(new Error('MAINTENANCE_CLIENT_PROTOCOL'));
        return;
      }
      buffer = Buffer.concat([buffer, bytes]);
      const end = buffer.indexOf(10);
      if (end < 0) return;
      try {
        if (end !== buffer.length - 1) throw new Error();
        const text = buffer.toString('utf8');
        if (!Buffer.from(text).equals(buffer)) throw new Error();
        const response = JSON.parse(text);
        if (response.ok === false && codes.has(response.code)) {
          finish(new Error(`MAINTENANCE_${response.code}`));
          return;
        }
        if (response.ok !== true) throw new Error();
        finish(null, checkedSnapshot(response.snapshot, identity));
      } catch {
        finish(new Error('MAINTENANCE_CLIENT_PROTOCOL'));
      }
    });
  });
}
