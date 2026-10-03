const { strict: assert } = require('node:assert');
const { createServer } = require('node:net');
const { setTimeout: wait } = require('node:timers/promises');

(async () => {
  const [module, leaf] = process.argv.slice(2);
  let accepted, didAccept;
  const peer = new Promise((resolve) => { didAccept = resolve; });
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    accepted = socket; didAccept(socket);
    socket.on('end', () => socket.end());
  });
  await new Promise((resolve) => server.listen(leaf, resolve));
  const addon = require(module);
  for (const bad of [0n, -1n, 1n << 80n, 5000, undefined, '5000'])
    assert.throws(() => addon.connectControl(bad));
  const original = addon.connectControl(process.hrtime.bigint() / 1000000n + 5000n);
  assert.deepEqual(Object.getOwnPropertyNames(original).sort(), ['check', 'close', 'end', 'read', 'ready', 'write']);
  assert.equal(original.ready(), true);
  assert.equal(JSON.stringify(original), '{}');
  assert.equal(Object.isFrozen(original), true);
  assert.throws(() => original.read.call({}));
  const socket = await peer;
  const got = new Promise((resolve) => socket.once('data', resolve));
  assert.equal(original.write(Buffer.from('synthetic-control')), 17);
  assert.equal((await got).toString(), 'synthetic-control');
  assert.equal(original.read(), undefined);
  socket.write('synthetic-response');
  let data;
  for (let i=0; i<100 && data === undefined; ++i) { data = original.read(); if (data === undefined) await wait(2); }
  assert.equal(data.toString(), 'synthetic-response');
  original.check();
  socket.end();
  let eof;
  for (let i=0; i<100 && eof === undefined; ++i) { eof = original.read(); if (eof === undefined) await wait(2); }
  assert.equal(eof, null);
  const closed = new Promise((resolve) => socket.once('close', resolve));
  original.end(); original.close(); original.close();
  assert.throws(() => original.check());
  await closed;
  // One initial boot transport plus the unchanged 32 business transports.
  let connections = 1;
  for (let i = 0; i < 32; ++i) {
    let next;
    try { next = i === 0 ? addon.connectControl(process.hrtime.bigint() / 1000000n + 30n) : addon.connectControl(); } catch { break; }
    const peer = await new Promise((resolve) => server.once('connection', resolve));
    const retired = new Promise((resolve) => peer.once('close', resolve));
    if (i === 0) {
      let received = 0;
      peer.on('data', (data) => { received += data.length; });
      await wait(40);
      assert.throws(() => next.write(Buffer.from('expired')));
      assert.equal(received, 0);
    }
    next.close();
    await retired;
    connections++;
  }
  await new Promise((resolve) => server.close(resolve));
  assert.equal(connections, 33, 'boot transport must leave 32 business attempts');
  assert.throws(() => addon.connectControl(), 'the 34th transport is refused');
})().catch((error) => { console.error(error); process.exit(1); });
