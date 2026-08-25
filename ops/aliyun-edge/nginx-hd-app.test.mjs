import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const config = await readFile(new URL('./nginx-hd-app.conf', import.meta.url), 'utf8');
const deployScript = await readFile(new URL('./deploy.sh', import.meta.url), 'utf8');
const spaDeployScript = await readFile(
  new URL('../../scripts/deploy-spa.sh', import.meta.url),
  'utf8',
);
const remoteInstaller = await readFile(
  new URL('./install-remote.sh', import.meta.url),
  'utf8',
).catch(() => '');
const remoteRollback = await readFile(
  new URL('./rollback-remote.sh', import.meta.url),
  'utf8',
).catch(() => '');

function locationBody(declaration) {
  const escapedDeclaration = declaration.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const route = config.match(
    new RegExp(`location ${escapedDeclaration} \\{(?<body>[\\s\\S]*?)\\n {4}\\}`),
  );
  assert.ok(route?.groups?.body, `missing ${declaration} route`);
  return route.groups.body;
}

function assertVerifiedVultrOrigin(route, expectedHost) {
  assert.match(route, /proxy_pass https:\/\/207\.148\.70\.106;/);
  assert.match(route, /proxy_ssl_server_name on;/);
  assert.match(route, /proxy_ssl_name holaday\.ai;/);
  assert.match(route, /proxy_ssl_verify on;/);
  assert.match(route, /proxy_ssl_verify_depth 3;/);
  assert.match(route, /proxy_ssl_trusted_certificate \/etc\/ssl\/certs\/ca-certificates\.crt;/);
  assert.match(route, new RegExp(`proxy_set_header Host ${expectedHost};`));
  assert.doesNotMatch(route, /proxy_pass https:\/\/holaday\.ai;/);
}

test('sends screencast WebSockets directly to the Vultr TLS origin', () => {
  const route = locationBody('^~ /screencast-ws/');

  assertVerifiedVultrOrigin(route, 'holaday\\.ai');
  assert.match(route, /proxy_set_header Upgrade \$http_upgrade;/);
  assert.match(route, /proxy_set_header Connection \$connection_upgrade;/);
});

test('preserves the Aliyun host for OAuth while bypassing Cloudflare', () => {
  const apiRoute = locationBody('/api/');

  assertVerifiedVultrOrigin(apiRoute, '\\$host');
});

test('sends both legacy WebSocket routes to the verified Vultr origin', () => {
  const vncRoute = locationBody('^~ /vnc-ws/');
  const workbenchRoute = locationBody('= /ws');

  assertVerifiedVultrOrigin(vncRoute, '\\$host');
  assertVerifiedVultrOrigin(workbenchRoute, '\\$host');
});

test('serves both web surfaces through the atomic current-release link', () => {
  assert.match(config, /root \/opt\/holaday-edge\/current\/apps\/holaday-landing;/);
  assert.match(config, /root \/opt\/holaday-edge\/current\/apps\/web-workbench\/dist;/);
});

test('packages and installs the landing site with the edge deployment', () => {
  assert.match(deployScript, /LANDING_DIR="apps\/holaday-landing"/);
  assert.match(deployScript, /PORTABLE_TAR_SCRIPT=.*scripts\/create-portable-tar\.sh/);
  assert.match(deployScript, /"\$PORTABLE_TAR_SCRIPT" "\$BUNDLE" --exclude='\._\*'/);
  assert.match(deployScript, /"\$SPA_DIR" "\$NGINX_CONF" "\$LANDING_DIR"/);
  assert.match(deployScript, /REMOTE_INSTALL_SCRIPT="ops\/aliyun-edge\/install-remote\.sh"/);
  assert.match(deployScript, /REMOTE_ROLLBACK_SCRIPT="ops\/aliyun-edge\/rollback-remote\.sh"/);
  assert.match(deployScript, /"\$REMOTE_ROLLBACK_SCRIPT"/);
  assert.match(remoteInstaller, /apps\/holaday-landing/);
  assert.match(remoteInstaller, /ops\/aliyun-edge\/rollback-remote\.sh/);
});

test('runs the ops release gate before uploading', () => {
  const gate = deployScript.indexOf('pnpm test:ops');
  const upload = deployScript.indexOf('\nrun_scp\n', gate);

  assert.ok(gate >= 0, 'missing ops release gate');
  assert.ok(upload >= 0, 'missing upload command');
  assert.ok(gate < upload, 'ops release gate must run before upload');
});

test('publishes the Aliyun SPA through the atomic edge release path', () => {
  assert.match(spaDeployScript, /ALIYUN_EDGE_DEPLOY=.*ops\/aliyun-edge\/deploy\.sh/);
  assert.match(
    spaDeployScript,
    /"\$PORTABLE_TAR_SCRIPT" "\$TARBALL" apps\/web-workbench\/dist apps\/holaday-landing "\$VULTR_WEB_SWITCH_SCRIPT"/,
  );
  assert.match(deployScript, /DEFAULT_RELEASE_ID="\$\(date -u \+%Y%m%d%H%M%S\)-\$\$"/);
  assert.match(deployScript, /RELEASE_ID="\$\{HOLADAY_EDGE_RELEASE_ID:-\$DEFAULT_RELEASE_ID\}"/);
  assert.match(spaDeployScript, /ALIYUN_RELEASE_ID="\$\(date -u \+%Y%m%d%H%M%S\)-\$\$"/);
  assert.match(
    spaDeployScript,
    /HOLADAY_EDGE_RELEASE_ID="\$ALIYUN_RELEASE_ID" SSHPASS="\$ALIYUN_PASSWORD" "\$ALIYUN_EDGE_DEPLOY"/,
  );
  assert.match(
    spaDeployScript,
    /ALIYUN_EDGE_RELEASE_SPA_PATH="\$ALIYUN_EDGE_ROOT\/releases\/\$ALIYUN_RELEASE_ID\/apps\/web-workbench\/dist"/,
  );
  assert.match(spaDeployScript, /rollback-remote\.sh/);
  assert.equal(
    spaDeployScript.match(/^\s+rollback_aliyun_edge "\$ALIYUN_RELEASE_ID"$/gm)?.length,
    2,
  );
  assert.equal(
    spaDeployScript.match(/^assert_aliyun_release_active "\$ALIYUN_RELEASE_ID"$/gm)?.length,
    2,
  );
  assert.doesNotMatch(spaDeployScript, /ALIYUN_RELEASE_ID=\$\(run_with_retry/);
  assert.doesNotMatch(spaDeployScript, /\/opt\/holaday-spa\/dist/);
});

test('keeps the Vultr web switch, smoke, and rollback sequence intact', () => {
  const upload = spaDeployScript.indexOf('echo "→ Uploading tarball to Vultr"');
  const stage = spaDeployScript.indexOf('echo "→ Staging Vultr web release"', upload);
  const swap = spaDeployScript.indexOf('echo "→ Switching Vultr web release"', stage);
  const smoke = spaDeployScript.indexOf('echo "→ Vultr smoke check', swap);
  const legalSmoke = spaDeployScript.indexOf('echo "→ Vultr legal-page smoke check', smoke);
  const rollback = spaDeployScript.indexOf('rollback_vultr_web', legalSmoke);

  assert.ok(upload >= 0, 'missing Vultr upload');
  assert.ok(stage > upload, 'Vultr stage must follow upload');
  assert.ok(swap > stage, 'Vultr switch must follow stage');
  assert.ok(smoke > swap, 'Vultr smoke must follow switch');
  assert.ok(legalSmoke > smoke, 'Vultr legal smoke must follow SPA smoke');
  assert.ok(rollback > legalSmoke, 'Vultr rollback must remain after smoke failure');
});

test('publishes the Vultr SPA and landing site as one rollback unit', () => {
  assert.match(spaDeployScript, /VULTR_LANDING_PATH="\/opt\/holaday-landing"/);
  assert.match(spaDeployScript, /VULTR_WEB_SWITCH_SCRIPT=.*switch-vultr-web-release\.sh/);
  assert.match(
    spaDeployScript,
    /apps\/web-workbench\/dist apps\/holaday-landing "\$VULTR_WEB_SWITCH_SCRIPT"/,
  );

  const switchStep = spaDeployScript.indexOf('echo "→ Switching Vultr web release"');
  const spaSmoke = spaDeployScript.indexOf('echo "→ Vultr smoke check', switchStep);
  const legalSmoke = spaDeployScript.indexOf('echo "→ Vultr legal-page smoke check', spaSmoke);
  const rollback = spaDeployScript.indexOf('rollback_vultr_web', legalSmoke);

  assert.ok(switchStep >= 0, 'missing combined Vultr web switch');
  assert.ok(spaSmoke > switchStep, 'SPA smoke must follow the combined switch');
  assert.ok(legalSmoke > spaSmoke, 'legal-page smoke must follow the SPA smoke');
  assert.ok(rollback > legalSmoke, 'combined rollback must remain after legal smoke failure');
});

test('supports password deployment on macOS without exposing the password', () => {
  assert.match(deployScript, /command -v sshpass/);
  assert.match(deployScript, /command -v expect/);
  assert.match(deployScript, /sshpass -e/);
  assert.match(deployScript, /\$env\(SSHPASS\)/);
  assert.match(deployScript, /run_scp/);
  assert.match(deployScript, /run_ssh/);
  assert.match(deployScript, /neither sshpass nor expect is available/);
  assert.doesNotMatch(deployScript, /spawn .*\$env\(SSHPASS\)/);
});

test('uses unique remote inputs and serializes deployments', () => {
  assert.match(deployScript, /RELEASE_ID=/);
  assert.match(deployScript, /holaday-edge-\$RELEASE_ID\.tar\.gz/);
  assert.match(deployScript, /install-remote-\$RELEASE_ID\.sh/);
  assert.match(remoteInstaller, /HOLADAY_FLOCK_BIN/);
  assert.match(remoteInstaller, /"\$FLOCK_BIN" -n 9/);
});

test('remote install stages changes and rolls back failed nginx validation', async () => {
  assert.match(remoteInstaller, /HOLADAY_EDGE_ROOT/);
  assert.match(remoteInstaller, /HOLADAY_NGINX_ROOT/);
  assert.match(remoteInstaller, /HOLADAY_CERT_ROOT/);
  assert.match(remoteInstaller, /HOLADAY_NGINX_BIN/);
  assert.match(remoteInstaller, /HOLADAY_FLOCK_BIN/);

  const certificateCheck = remoteInstaller.indexOf('if [[ ! -f "$CERT_PATH" ]]');
  const firstActiveSwap = remoteInstaller.indexOf('replace_link "$RELEASE_ROOT" "$CURRENT_PATH"');

  assert.ok(certificateCheck >= 0, 'missing certificate preflight');
  assert.ok(firstActiveSwap >= 0, 'missing atomic current-release swap');
  assert.ok(
    certificateCheck < firstActiveSwap,
    'certificate preflight must precede active changes',
  );
  assert.match(remoteInstaller, /rollback\(\)/);
  assert.match(remoteInstaller, /if ! "\$NGINX_BIN" -t; then/);
  assert.match(remoteInstaller, /if ! "\$NGINX_BIN" -s reload; then/);

  const fixture = await mkdtemp(join(tmpdir(), 'holaday-edge-install-'));
  const edgeRoot = join(fixture, 'edge');
  const nginxRoot = join(fixture, 'nginx');
  const certRoot = join(fixture, 'certs');
  const bundleRoot = join(fixture, 'bundle-root');
  const oldRelease = join(edgeRoot, 'releases', 'old');
  const configPath = join(nginxRoot, 'sites-available', 'hd-app.orangebench.tech');
  const enabledPath = join(nginxRoot, 'sites-enabled', 'hd-app.orangebench.tech');
  const oldConfigTarget = join(fixture, 'old-nginx.conf');
  const bundle = join(fixture, 'release.tar.gz');
  const installerCopy = join(fixture, 'install-copy.sh');
  const fakeNginx = join(fixture, 'fake-nginx.sh');
  const fakeNginxState = join(fixture, 'fake-nginx-state');
  const fakeFlock = join(fixture, 'fake-flock.sh');

  await mkdir(join(oldRelease, 'apps'), { recursive: true });
  await mkdir(join(nginxRoot, 'sites-available'), { recursive: true });
  await mkdir(join(nginxRoot, 'sites-enabled'), { recursive: true });
  await mkdir(join(nginxRoot, 'conf.d'), { recursive: true });
  await mkdir(join(certRoot, 'hd-app.orangebench.tech'), { recursive: true });
  await mkdir(join(bundleRoot, 'apps', 'web-workbench', 'dist'), { recursive: true });
  await mkdir(join(bundleRoot, 'apps', 'holaday-landing'), { recursive: true });
  await mkdir(join(bundleRoot, 'ops', 'aliyun-edge'), { recursive: true });

  await writeFile(join(certRoot, 'hd-app.orangebench.tech', 'fullchain.pem'), 'cert');
  await writeFile(join(certRoot, 'hd-app.orangebench.tech', 'privkey.pem'), 'key');
  await writeFile(join(bundleRoot, 'apps', 'web-workbench', 'dist', 'index.html'), 'spa');
  await writeFile(join(bundleRoot, 'apps', 'holaday-landing', 'index.html'), 'landing');
  await writeFile(join(bundleRoot, 'ops', 'aliyun-edge', 'nginx-hd-app.conf'), 'candidate config');
  await writeFile(join(bundleRoot, 'ops', 'aliyun-edge', 'rollback-remote.sh'), remoteRollback);
  await writeFile(oldConfigTarget, 'old config');
  await writeFile(join(nginxRoot, 'conf.d', 'upgrade.conf'), 'connection_upgrade');
  await symlink(oldRelease, join(edgeRoot, 'current'));
  await symlink(oldConfigTarget, configPath);
  await symlink(configPath, enabledPath);
  await writeFile(installerCopy, remoteInstaller);
  await writeFile(
    fakeNginx,
    `#!/usr/bin/env bash
if [[ "$1" == "-t" ]]; then
  count=0
  [[ -f "${fakeNginxState}" ]] && count="$(cat "${fakeNginxState}")"
  echo $((count + 1)) >"${fakeNginxState}"
  [[ "$count" -gt 0 ]]
  exit
fi
exit 0
`,
  );
  await chmod(fakeNginx, 0o755);
  await writeFile(fakeFlock, '#!/usr/bin/env bash\nexit 0\n');
  await chmod(fakeFlock, 0o755);

  const archive = spawnSync('tar', ['czf', bundle, '-C', bundleRoot, 'apps', 'ops']);
  assert.equal(archive.status, 0, archive.stderr?.toString());

  const install = spawnSync(
    'bash',
    [
      new URL('./install-remote.sh', import.meta.url).pathname,
      'hd-app.orangebench.tech',
      bundle,
      'new',
      installerCopy,
    ],
    {
      env: {
        ...process.env,
        HOLADAY_CERT_ROOT: certRoot,
        HOLADAY_EDGE_ROOT: edgeRoot,
        HOLADAY_FLOCK_BIN: fakeFlock,
        HOLADAY_NGINX_BIN: fakeNginx,
        HOLADAY_NGINX_ROOT: nginxRoot,
      },
    },
  );

  assert.notEqual(install.status, 0, 'candidate nginx validation should fail');
  assert.equal(await readlink(join(edgeRoot, 'current')), oldRelease);
  assert.equal(await readlink(configPath), oldConfigTarget);
  assert.equal(await readlink(enabledPath), configPath);
  assert.equal(await readFile(oldConfigTarget, 'utf8'), 'old config');

  const committedRelease = join(edgeRoot, 'releases', 'committed');
  await writeFile(installerCopy, remoteInstaller);
  const committedArchive = spawnSync('tar', ['czf', bundle, '-C', bundleRoot, 'apps', 'ops']);
  assert.equal(committedArchive.status, 0, committedArchive.stderr?.toString());

  const committedInstall = spawnSync(
    'bash',
    [
      new URL('./install-remote.sh', import.meta.url).pathname,
      'hd-app.orangebench.tech',
      bundle,
      'committed',
      installerCopy,
    ],
    {
      env: {
        ...process.env,
        HOLADAY_CERT_ROOT: certRoot,
        HOLADAY_EDGE_ROOT: edgeRoot,
        HOLADAY_FLOCK_BIN: fakeFlock,
        HOLADAY_NGINX_BIN: fakeNginx,
        HOLADAY_NGINX_ROOT: nginxRoot,
      },
    },
  );

  assert.equal(committedInstall.status, 0, committedInstall.stderr?.toString());
  assert.equal(await readlink(join(edgeRoot, 'current')), committedRelease);
  assert.equal(
    await readlink(configPath),
    join(committedRelease, 'ops', 'aliyun-edge', 'nginx-hd-app.conf'),
  );

  const postCommitRollback = spawnSync(
    'bash',
    [
      new URL('./rollback-remote.sh', import.meta.url).pathname,
      'hd-app.orangebench.tech',
      'committed',
    ],
    {
      env: {
        ...process.env,
        HOLADAY_EDGE_ROOT: edgeRoot,
        HOLADAY_FLOCK_BIN: fakeFlock,
        HOLADAY_NGINX_BIN: fakeNginx,
        HOLADAY_NGINX_ROOT: nginxRoot,
      },
    },
  );

  assert.equal(postCommitRollback.status, 0, postCommitRollback.stderr?.toString());
  assert.equal(await readlink(join(edgeRoot, 'current')), oldRelease);
  assert.equal(await readlink(configPath), oldConfigTarget);
  assert.equal(await readlink(enabledPath), configPath);
  assert.equal(await readFile(oldConfigTarget, 'utf8'), 'old config');

  await unlink(join(edgeRoot, 'current'));
  await writeFile(installerCopy, remoteInstaller);
  const initialArchive = spawnSync('tar', ['czf', bundle, '-C', bundleRoot, 'apps', 'ops']);
  assert.equal(initialArchive.status, 0, initialArchive.stderr?.toString());

  const initialInstall = spawnSync(
    'bash',
    [
      new URL('./install-remote.sh', import.meta.url).pathname,
      'hd-app.orangebench.tech',
      bundle,
      'initial',
      installerCopy,
    ],
    {
      env: {
        ...process.env,
        HOLADAY_CERT_ROOT: certRoot,
        HOLADAY_EDGE_ROOT: edgeRoot,
        HOLADAY_FLOCK_BIN: fakeFlock,
        HOLADAY_NGINX_BIN: fakeNginx,
        HOLADAY_NGINX_ROOT: nginxRoot,
      },
    },
  );
  assert.equal(initialInstall.status, 0, initialInstall.stderr?.toString());

  const initialRollback = spawnSync(
    'bash',
    [
      new URL('./rollback-remote.sh', import.meta.url).pathname,
      'hd-app.orangebench.tech',
      'initial',
    ],
    {
      env: {
        ...process.env,
        HOLADAY_EDGE_ROOT: edgeRoot,
        HOLADAY_FLOCK_BIN: fakeFlock,
        HOLADAY_NGINX_BIN: fakeNginx,
        HOLADAY_NGINX_ROOT: nginxRoot,
      },
    },
  );

  assert.equal(initialRollback.status, 0, initialRollback.stderr?.toString());
  await assert.rejects(readlink(join(edgeRoot, 'current')), { code: 'ENOENT' });
  assert.equal(await readlink(configPath), oldConfigTarget);
  assert.equal(await readlink(enabledPath), configPath);
});
