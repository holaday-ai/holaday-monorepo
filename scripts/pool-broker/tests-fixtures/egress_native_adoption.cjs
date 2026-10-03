// Real in-process FD creator and documented Node adoption; no private handles.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const { once } = require('node:events');

(async () => {
  const native = require(process.argv[2]);
  const path = process.argv[3];
  assert.throws(() => native.createListener('arbitrary-path'), /POOL_EGRESS_NATIVE_INVALID/);
  let original = native.createListener();
  const mode = process.argv[4];
  const finalized = async expected => {
    const deadline = performance.now() + 2000;
    while (!fs.existsSync(`${path}.finalized`) && performance.now() < deadline) {
      global.gc();
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.equal(fs.readFileSync(`${path}.finalized`, 'utf8'), expected);
  };
  if (mode === 'gc-before') {
    original = null;
    await finalized('n'); // Written only after the actual N-API finalizer close.
    assert(fs.lstatSync(path).isSocket());
    const denied = net.connect(path);
    const [error] = await once(denied, 'error');
    assert.equal(error.code, 'ECONNREFUSED');
    return;
  }
  assert(Object.isFrozen(original));
  assert.throws(() => native.createListener(), /POOL_EGRESS_NATIVE_INVALID/);
  assert.throws(() => original.take.call({}), /POOL_EGRESS_NATIVE_INVALID/);
  assert.throws(() => original.take(1), /POOL_EGRESS_NATIVE_INVALID/);
  const fd = original.take();
  assert.throws(() => original.take(), /POOL_EGRESS_NATIVE_INVALID/);
  original.close(); // Must leave transferred FD live.
  const server = net.createServer(socket => socket.end('synthetic'));
  const listening = once(server, 'listening');
  server.listen({ fd, exclusive: true });
  await listening;
  if (mode === 'gc-after') {
    original = null;
    await finalized('t');
    assert(fs.fstatSync(fd).isSocket());
  }
  const client = net.connect(path);
  let text = '';
  client.setEncoding('utf8');
  client.on('data', data => { text += data; });
  await once(client, 'close');
  assert.equal(text, 'synthetic');
  fs.renameSync(path, `${path}.original`);
  fs.writeFileSync(path, 'replacement', { flag: 'wx' });
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  assert.equal(fs.readFileSync(path, 'utf8'), 'replacement');
  assert(fs.lstatSync(`${path}.original`).isSocket());
  const reused = fs.openSync('/dev/null', 'r');
  original?.close();
  assert(fs.fstatSync(reused).isCharacterDevice());
  fs.closeSync(reused);
})().catch(error => { console.error(error); process.exitCode = 1; });
