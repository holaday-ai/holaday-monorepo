// Run from the development host with Docker. Own disposable containers/network
// only: no host networking, production mounts, credentials or published ports.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const image = 'holaday-first-cutover-network:qa';
const network = `holaday-payment-qa-${randomUUID()}`;
const containers = [];
let createdNetwork = false;
function docker(args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'docker',
      args,
      { timeout: 30000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) =>
        error ? reject(Object.assign(error, { stderr })) : resolve(stdout.trim()),
    );
    child.stdin.end(input);
  });
}
async function start(alias, command, admin = false) {
  const id = await docker([
    'run',
    '-d',
    '--network',
    network,
    '--network-alias',
    alias,
    ...(admin ? ['--cap-add', 'NET_ADMIN'] : []),
    image,
    ...command,
  ]);
  assert.match(id, /^[a-f0-9]{64}$/);
  containers.push(id);
  return id;
}
const node = '/opt/node22/bin/node';
const targetCode = `
const http=require('node:http'), fs=require('node:fs'), {execFileSync}=require('node:child_process');
Promise.all([22,4010,4011,8080].map(port=>new Promise(resolve=>{
 const s=http.createServer((req,res)=>res.end('qa-'+port));s.keepAliveTimeout=60000;s.listen(port,'::',resolve);
}))).then(()=>{
 fs.writeFileSync('/tmp/qa-nginx.conf','pid /tmp/qa-nginx.pid; error_log /tmp/qa-nginx.log; events {} http { access_log off; server { listen 443; listen [::]:443; location / { proxy_pass http://127.0.0.1:4010; } } }');
 execFileSync('nginx',['-c','/tmp/qa-nginx.conf']); console.log('READY');
});`;
const queryCode = `
const http=require('node:http');const [host,port]=process.argv.slice(1);
const req=http.get({host,port:Number(port),path:'/',timeout:2000},res=>{
 let b='';res.on('data',d=>b+=d);res.on('end',()=>console.log(JSON.stringify({status:res.statusCode,body:b})));
});req.on('timeout',()=>req.destroy(Object.assign(new Error(),{code:'TIMEOUT'})));
req.on('error',e=>console.log(JSON.stringify({error:e.code})));`;
const get = async (client, host, port) =>
  JSON.parse(await docker(['exec', client, node, '-e', queryCode, host, String(port)]));
const heldClients = [];
async function holdConnection(client, host) {
  const code = `
const http=require('node:http'), agent=new http.Agent({keepAlive:true});
const options={host:process.argv[1],port:4010,path:'/',agent,timeout:3000};
http.get(options,res=>{res.resume();res.on('end',()=>{
 console.log('READY');process.stdin.once('data',()=>{
  const req=http.get(options,res=>{res.resume();res.on('end',()=>{
   console.log(JSON.stringify({status:res.statusCode,reused:req.reusedSocket}));agent.destroy();process.stdin.pause();
  });});
  req.on('timeout',()=>req.destroy(Object.assign(new Error(),{code:'TIMEOUT'})));
  req.on('error',e=>{console.log(JSON.stringify({error:e.code,reused:req.reusedSocket}));agent.destroy();process.stdin.pause();});
 });
});});`;
  let child;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const completed = new Promise((resolve, reject) => {
    child = execFile(
      'docker',
      ['exec', '-i', client, node, '-e', code, host],
      { timeout: 20000 },
      (error, stdout) => {
        if (error) {
          rejectReady(error);
          reject(error);
        } else resolve(stdout);
      },
    );
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('READY')) resolveReady();
    });
  });
  completed.catch(() => {});
  heldClients.push(child);
  await ready;
  return async () => {
    child.stdin.end('continue\n');
    const lines = (await completed).trim().split('\n');
    return JSON.parse(lines.at(-1));
  };
}
try {
  await docker([
    'network',
    'create',
    '--internal',
    '--ipv6',
    '--label',
    'holaday.qa=payment-ingress',
    network,
  ]);
  createdNetwork = true;
  const target = await start('gateway', [node, '-e', targetCode], true);
  const client = await start('client', ['sleep', '300']);
  for (let i = 0; i < 50; i++) {
    if ((await docker(['logs', target])).includes('READY')) break;
    await sleep(100);
  }
  assert.match(await docker(['logs', target]), /READY/);
  const details = JSON.parse(await docker(['inspect', target]))[0].NetworkSettings.Networks[
    network
  ];
  const addresses = [details.IPAddress, details.GlobalIPv6Address];
  assert.ok(addresses.every(Boolean), 'need actual IPv4 and IPv6 peer addresses');
  const nft = (input) => docker(['exec', '-i', target, 'nft', '-f', '-'], input);
  await nft(
    'create table inet qa_unrelated\nadd chain inet qa_unrelated keep { type filter hook input priority 0; policy accept; }\n',
  );
  const unrelated = await docker([
    'exec',
    target,
    'nft',
    '-j',
    'list',
    'table',
    'inet',
    'qa_unrelated',
  ]);
  for (const host of addresses)
    for (const port of [4010, 4011]) {
      assert.equal(
        (await get(client, host, port)).status,
        200,
        'baseline must prove reachable peers',
      );
    }
  // Negative control proves the assertions catch the actual unfenced network.
  const resumed = await Promise.all(addresses.map((host) => holdConnection(client, host)));
  const policy = process.argv.includes('--without-policy')
    ? ''
    : await readFile(
        new URL('../../ops/aliyun-edge/holaday-payment-ingress.nft', import.meta.url),
        'utf8',
      );
  if (policy) await nft(policy);
  for (const resume of resumed) {
    assert.deepEqual(
      await resume(),
      { error: 'ECONNRESET', reused: true },
      'existing TCP connections must not bypass the fence',
    );
  }
  for (const host of addresses) {
    for (const port of [4010, 4011])
      assert.equal((await get(client, host, port)).error, 'ECONNREFUSED');
    for (const port of [22, 443, 8080]) assert.equal((await get(client, host, port)).status, 200);
  }
  for (const host of ['127.0.0.1', '::1'])
    for (const port of [4010, 4011]) {
      assert.equal(
        (await get(target, host, port)).status,
        200,
        'nginx loopback must remain usable',
      );
    }
  assert.equal(
    await docker(['exec', target, 'nft', '-j', 'list', 'table', 'inet', 'qa_unrelated']),
    unrelated,
  );
  const installed = await docker(['exec', target, 'nft', '-j', 'list', 'ruleset']);
  await assert.rejects(nft(policy), /Command failed/); // No replacement/adoption of an existing table.
  assert.equal(await docker(['exec', target, 'nft', '-j', 'list', 'ruleset']), installed);
  console.log(
    'PASS: IPv4/IPv6 new and established direct connections rejected; both loopbacks, nginx proxy, SSH-port and unrelated-port preserved; unrelated rules unchanged; repeat refused atomically.',
  );
} finally {
  for (const child of heldClients) if (child.exitCode === null) child.kill();
  for (const id of containers.reverse()) await docker(['rm', '-f', id]);
  if (createdNetwork) await docker(['network', 'rm', network]);
}
