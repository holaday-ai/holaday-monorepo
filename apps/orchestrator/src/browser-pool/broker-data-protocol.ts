import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface BrokerDataScope {
  readonly candidate: string;
  readonly boot: string;
  readonly resource: string;
}

const fail = (): never => {
  throw new Error('POOL_BROKER_DATA_INVALID');
};
const zero = Buffer.alloc(32);
const same = (a: Buffer, b: Buffer): boolean => a.length === b.length && timingSafeEqual(a, b);

function context(scope: BrokerDataScope): Buffer {
  try {
    if (!scope || Object.keys(scope).sort().join(',') !== 'boot,candidate,resource') fail();
    const { candidate, resource, boot } = scope;
    for (const [value, length] of [
      [candidate, 40],
      [resource, 32],
      [boot, 32],
    ] as const) {
      if (
        typeof value !== 'string' ||
        value.length !== length ||
        !/^[0-9a-f]+$/.test(value) ||
        /^0+$/.test(value)
      )
        fail();
    }
    return Buffer.concat([
      Buffer.from(candidate, 'hex'),
      Buffer.from(resource, 'hex'),
      Buffer.from(boot, 'hex'),
    ]);
  } catch {
    return fail();
  }
}

function keyCopy(key: Buffer): Buffer {
  if (!Buffer.isBuffer(key) || key.length !== 32 || same(key, zero)) fail();
  return Buffer.from(key);
}

export function deriveBrokerDataKey(key: Buffer, scope: BrokerDataScope): Buffer {
  const ctx = context(scope);
  const owned = keyCopy(key);
  try {
    return createHmac('sha256', owned)
      .update('HoladayPool/CDP-VNC/data-key/v1\0')
      .update(ctx.subarray(0, 20))
      .update(ctx.subarray(36))
      .update(ctx.subarray(20, 36))
      .update(Buffer.from([1]))
      .digest();
  } finally {
    owned.fill(0);
  }
}

function nonce(other = zero): Buffer {
  const value = randomBytes(32);
  if (same(value, zero) || same(value, other)) {
    value.fill(0);
    fail();
  }
  return value;
}

// Pure codecs only. The socket owner separately enforces identity, deadlines and drain.
function codec(scope: BrokerDataScope, key: Buffer, egress: boolean, kind: number) {
  const ctx = context(scope);
  if (egress ? kind !== 3 : kind !== 1 && kind !== 2) fail();
  const owned = keyCopy(key);
  const magic = Buffer.from(egress ? 'HPG1' : 'HPD1');
  const domain = Buffer.from(
    egress ? 'HoladayPool/egress-auth/v1\0' : 'HoladayPool/data-auth/v1\0',
  );
  let closed = false;
  const secrets: Buffer[] = [owned, ctx];
  const keep = (value: Buffer): Buffer => {
    secrets.push(value);
    return value;
  };
  const close = () => {
    closed = true;
    for (const value of secrets) value.fill(0);
    secrets.length = 0;
  };
  const assertOpen = () => {
    if (closed) fail();
  };
  const sign = (
    type: number,
    server: Buffer,
    client: Buffer,
    transcript = Buffer.alloc(0),
  ): Buffer => {
    assertOpen();
    const header = Buffer.concat([magic, Buffer.from([type, kind]), ctx, server, client]);
    return Buffer.concat([
      header,
      createHmac('sha256', owned).update(domain).update(header).update(transcript).digest(),
    ]);
  };
  const read = (frame: Buffer, type: number, transcript = Buffer.alloc(0)) => {
    assertOpen();
    if (!Buffer.isBuffer(frame) || frame.length !== 154) fail();
    const server = frame.subarray(58, 90);
    const client = frame.subarray(90, 122);
    const expected = sign(type, server, client, transcript);
    try {
      if (!same(frame, expected)) fail();
    } finally {
      expected.fill(0);
    }
    return {
      server: keep(Buffer.from(server)),
      client: keep(Buffer.from(client)),
      tag: keep(Buffer.from(frame.subarray(122))),
    };
  };
  const attempt = <T>(action: () => T): T => {
    try {
      assertOpen();
      return action();
    } catch {
      close();
      return fail();
    }
  };
  return { sign, read, keep, close, attempt };
}

export function createBrokerDataHandshake(
  scope: BrokerDataScope,
  key: Buffer,
  kind: 1 | 2,
  challenge: Buffer,
) {
  const c = codec(scope, key, false, kind);
  return c.attempt(() => {
    const original = c.read(challenge, 1);
    if (same(original.server, zero) || !same(original.client, zero)) fail();
    const client = c.keep(nonce(original.server));
    const response = c.sign(2, original.server, client);
    const tag = c.keep(Buffer.from(response.subarray(122)));
    return {
      response,
      acceptAcknowledgement(ack: Buffer): void {
        c.attempt(() => {
          const answer = c.read(ack, 3, tag);
          if (!same(answer.server, original.server) || !same(answer.client, client)) fail();
          c.close();
        });
      },
      close: c.close,
    };
  });
}

export function replyToBrokerEgressProbe(scope: BrokerDataScope, request: Buffer): Buffer {
  const ctx = context(scope);
  if (
    !Buffer.isBuffer(request) ||
    request.length !== 89 ||
    request.subarray(0, 4).toString() !== 'HPE1' ||
    request[4] !== 1 ||
    !same(request.subarray(5, 57), ctx) ||
    same(request.subarray(57), zero)
  )
    fail();
  const result = Buffer.from(request);
  result[4] = 2;
  return result;
}

export function createEgressClientHandshake(scope: BrokerDataScope, key: Buffer) {
  const c = codec(scope, key, true, 3);
  return c.attempt(() => {
    const client = c.keep(nonce());
    const hello = c.sign(1, zero, client);
    const helloTag = c.keep(Buffer.from(hello.subarray(122)));
    return {
      hello,
      answerChallenge(challenge: Buffer): Buffer {
        return c.attempt(() => {
          const answer = c.read(challenge, 2, helloTag);
          if (
            !same(answer.client, client) ||
            same(answer.server, zero) ||
            same(answer.server, client)
          )
            fail();
          const transcript = c.keep(Buffer.concat([answer.tag, helloTag]));
          const ack = c.sign(3, answer.server, client, transcript);
          c.close();
          return ack;
        });
      },
      close: c.close,
    };
  });
}

export function acceptEgressClientHandshake(scope: BrokerDataScope, key: Buffer, hello: Buffer) {
  const c = codec(scope, key, true, 3);
  return c.attempt(() => {
    const original = c.read(hello, 1);
    if (!same(original.server, zero) || same(original.client, zero)) fail();
    const server = c.keep(nonce(original.client));
    const challenge = c.sign(2, server, original.client, original.tag);
    const transcript = c.keep(Buffer.concat([challenge.subarray(122), original.tag]));
    return {
      challenge,
      acceptAcknowledgement(ack: Buffer): void {
        c.attempt(() => {
          const answer = c.read(ack, 3, transcript);
          if (!same(answer.server, server) || !same(answer.client, original.client)) fail();
          c.close();
        });
      },
      close: c.close,
    };
  });
}
