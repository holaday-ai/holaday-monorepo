import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const switchScript = new URL('../../scripts/switch-vultr-web-release.sh', import.meta.url);

async function createFixture({ includeLandingIndex = true, includeTerms = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'holaday-vultr-web-'));
  const spa = join(root, 'live-spa');
  const landing = join(root, 'live-landing');
  const stage = join(root, 'stage');
  const stagedSpa = join(stage, 'apps', 'web-workbench', 'dist');
  const stagedLanding = join(stage, 'apps', 'holaday-landing');
  const privacy = 'new privacy';
  const terms = 'new terms';

  await mkdir(spa, { recursive: true });
  await mkdir(landing, { recursive: true });
  await mkdir(stagedSpa, { recursive: true });
  await mkdir(stagedLanding, { recursive: true });
  await writeFile(join(spa, 'index.html'), 'old spa');
  await writeFile(join(landing, 'privacy.html'), 'old privacy');
  await writeFile(join(landing, 'terms.html'), 'old terms');
  await writeFile(join(stagedSpa, 'index.html'), '<script src="/assets/index-new.js"></script>');
  if (includeLandingIndex) await writeFile(join(stagedLanding, 'index.html'), 'new landing');
  await writeFile(join(stagedLanding, 'privacy.html'), privacy);
  if (includeTerms) await writeFile(join(stagedLanding, 'terms.html'), terms);

  const manifestResult = spawnSync(
    'bash',
    [switchScript.pathname, 'manifest', stagedSpa, stagedLanding],
    { encoding: 'utf8' },
  );
  assert.equal(manifestResult.status, 0, manifestResult.stderr);

  return {
    env: {
      ...process.env,
      VULTR_WEB_LANDING_BACKUP_PATH: `${landing}.bak`,
      VULTR_WEB_LANDING_PATH: landing,
      VULTR_WEB_SPA_BACKUP_PATH: `${spa}.bak`,
      VULTR_WEB_SPA_PATH: spa,
      VULTR_WEB_STATE_PATH: join(root, 'release.state'),
    },
    landing,
    manifest: manifestResult.stdout.trim(),
    root,
    spa,
    stage,
  };
}

function runSwitch(fixture, action = 'activate', envOverrides = {}) {
  const args = [switchScript.pathname, action];
  if (action === 'activate') {
    args.push(fixture.stage, 'index-new.js', fixture.manifest);
  }
  return spawnSync('bash', args, {
    env: { ...fixture.env, ...envOverrides },
    encoding: 'utf8',
  });
}

async function createSignallingMv(fixture, signal) {
  const marker = join(fixture.root, `signal-${signal}.sent`);
  const signallingMv = join(fixture.root, `signal-${signal}-mv.sh`);
  await writeFile(
    signallingMv,
    `#!/usr/bin/env bash
/bin/mv "$@"
if [[ ! -f "${marker}" ]]; then
  : >"${marker}"
  kill -${signal} "$PPID"
fi
`,
  );
  await chmod(signallingMv, 0o755);
  return signallingMv;
}

async function createKillAfterMv(fixture, moveNumber) {
  const counter = join(fixture.root, `kill-after-${moveNumber}-counter`);
  const killingMv = join(fixture.root, `kill-after-${moveNumber}-mv.sh`);
  await writeFile(
    killingMv,
    `#!/usr/bin/env bash
count=0
[[ -f "${counter}" ]] && count="$(cat "${counter}")"
count=$((count + 1))
printf '%s' "$count" >"${counter}"
/bin/mv "$@"
if [[ "$count" == "${moveNumber}" ]]; then
  kill -KILL "$PPID"
fi
`,
  );
  await chmod(killingMv, 0o755);
  return killingMv;
}

async function restageCandidate(fixture) {
  const stagedSpa = join(fixture.stage, 'apps', 'web-workbench', 'dist');
  const stagedLanding = join(fixture.stage, 'apps', 'holaday-landing');
  await mkdir(stagedSpa, { recursive: true });
  await mkdir(stagedLanding, { recursive: true });
  await writeFile(join(stagedSpa, 'index.html'), '<script src="/assets/index-new.js"></script>');
  await writeFile(join(stagedLanding, 'index.html'), 'new landing');
  await writeFile(join(stagedLanding, 'privacy.html'), 'new privacy');
  await writeFile(join(stagedLanding, 'terms.html'), 'new terms');
}

test('activates and rolls back the SPA and landing site together', async () => {
  const fixture = await createFixture();

  const activate = runSwitch(fixture);
  assert.equal(activate.status, 0, activate.stderr);
  assert.match(await readFile(join(fixture.spa, 'index.html'), 'utf8'), /index-new\.js/);
  assert.equal(await readFile(join(fixture.landing, 'privacy.html'), 'utf8'), 'new privacy');
  assert.equal(await readFile(join(fixture.landing, 'terms.html'), 'utf8'), 'new terms');

  const retry = runSwitch(fixture);
  assert.equal(retry.status, 0, retry.stderr);

  const rollback = runSwitch(fixture, 'rollback');
  assert.equal(rollback.status, 0, rollback.stderr);
  assert.equal(await readFile(join(fixture.spa, 'index.html'), 'utf8'), 'old spa');
  assert.equal(await readFile(join(fixture.landing, 'privacy.html'), 'utf8'), 'old privacy');
  assert.equal(await readFile(join(fixture.landing, 'terms.html'), 'utf8'), 'old terms');
});

test('rejects an incomplete staged release without changing either live surface', async () => {
  const fixture = await createFixture({ includeTerms: false });

  const activate = runSwitch(fixture);
  assert.notEqual(activate.status, 0);
  assert.equal(await readFile(join(fixture.spa, 'index.html'), 'utf8'), 'old spa');
  assert.equal(await readFile(join(fixture.landing, 'privacy.html'), 'utf8'), 'old privacy');
  await assert.rejects(access(`${fixture.spa}.bak`), { code: 'ENOENT' });
  await assert.rejects(access(`${fixture.landing}.bak`), { code: 'ENOENT' });
});

test('rejects a staged release without the landing home page', async () => {
  const fixture = await createFixture({ includeLandingIndex: false });

  const activate = runSwitch(fixture);
  assert.notEqual(activate.status, 0);
  assert.equal(await readFile(join(fixture.spa, 'index.html'), 'utf8'), 'old spa');
  assert.equal(await readFile(join(fixture.landing, 'privacy.html'), 'utf8'), 'old privacy');
});

test('preserves the original rollback pair when the same release is staged again', async () => {
  const fixture = await createFixture();
  assert.equal(runSwitch(fixture).status, 0);

  const stagedSpa = join(fixture.stage, 'apps', 'web-workbench', 'dist');
  const stagedLanding = join(fixture.stage, 'apps', 'holaday-landing');
  await mkdir(stagedSpa, { recursive: true });
  await mkdir(stagedLanding, { recursive: true });
  await writeFile(join(stagedSpa, 'index.html'), '<script src="/assets/index-new.js"></script>');
  await writeFile(join(stagedLanding, 'index.html'), 'new landing');
  await writeFile(join(stagedLanding, 'privacy.html'), 'new privacy');
  await writeFile(join(stagedLanding, 'terms.html'), 'new terms');

  assert.equal(runSwitch(fixture).status, 0);
  assert.equal(runSwitch(fixture, 'rollback').status, 0);
  assert.equal(await readFile(join(fixture.spa, 'index.html'), 'utf8'), 'old spa');
  assert.equal(await readFile(join(fixture.landing, 'privacy.html'), 'utf8'), 'old privacy');
});

test('restores the candidate and remains retryable when rollback is interrupted', async () => {
  const fixture = await createFixture();
  assert.equal(runSwitch(fixture).status, 0);

  const mvCounter = join(fixture.root, 'mv-counter');
  const failingMv = join(fixture.root, 'fail-fourth-mv.sh');
  await writeFile(
    failingMv,
    `#!/usr/bin/env bash
count=0
[[ -f "${mvCounter}" ]] && count="$(cat "${mvCounter}")"
count=$((count + 1))
printf '%s' "$count" >"${mvCounter}"
if [[ "$count" == "4" ]]; then exit 71; fi
exec mv "$@"
`,
  );
  await chmod(failingMv, 0o755);

  const interrupted = runSwitch(fixture, 'rollback', { VULTR_WEB_MV_BIN: failingMv });
  assert.notEqual(interrupted.status, 0);
  assert.match(await readFile(join(fixture.spa, 'index.html'), 'utf8'), /index-new\.js/);
  assert.equal(await readFile(join(fixture.landing, 'privacy.html'), 'utf8'), 'new privacy');

  assert.equal(runSwitch(fixture, 'rollback').status, 0);
  assert.equal(runSwitch(fixture, 'rollback').status, 0);
  assert.equal(await readFile(join(fixture.spa, 'index.html'), 'utf8'), 'old spa');
  assert.equal(await readFile(join(fixture.landing, 'privacy.html'), 'utf8'), 'old privacy');
});

test('rejects cross-colliding and dot-segment deployment paths', async () => {
  const fixture = await createFixture();
  const collidingBackup = fixture.env.VULTR_WEB_SPA_BACKUP_PATH;
  const collision = runSwitch(fixture, 'activate', {
    VULTR_WEB_LANDING_BACKUP_PATH: collidingBackup,
  });
  assert.notEqual(collision.status, 0);
  assert.equal(await readFile(join(fixture.spa, 'index.html'), 'utf8'), 'old spa');
  assert.equal(await readFile(join(fixture.landing, 'privacy.html'), 'utf8'), 'old privacy');

  const alias = runSwitch(fixture, 'activate', {
    VULTR_WEB_LANDING_BACKUP_PATH: join(fixture.root, 'nested', '..', 'live-spa'),
  });
  assert.notEqual(alias.status, 0);
  assert.equal(await readFile(join(fixture.spa, 'index.html'), 'utf8'), 'old spa');
});

test('TERM after an activation rename exits nonzero and restores the old pair', async () => {
  const fixture = await createFixture();
  const signallingMv = await createSignallingMv(fixture, 'TERM');

  const interrupted = runSwitch(fixture, 'activate', { VULTR_WEB_MV_BIN: signallingMv });
  assert.notEqual(interrupted.status, 0);
  assert.equal(await readFile(join(fixture.spa, 'index.html'), 'utf8'), 'old spa');
  assert.equal(await readFile(join(fixture.landing, 'privacy.html'), 'utf8'), 'old privacy');
  await assert.rejects(access(`${fixture.spa}.bak`), { code: 'ENOENT' });
  await assert.rejects(access(`${fixture.landing}.bak`), { code: 'ENOENT' });

  assert.equal(runSwitch(fixture).status, 0);
});

test('HUP after a rollback rename exits nonzero and restores the candidate pair', async () => {
  const fixture = await createFixture();
  assert.equal(runSwitch(fixture).status, 0);
  const signallingMv = await createSignallingMv(fixture, 'HUP');

  const interrupted = runSwitch(fixture, 'rollback', { VULTR_WEB_MV_BIN: signallingMv });
  assert.notEqual(interrupted.status, 0);
  assert.match(await readFile(join(fixture.spa, 'index.html'), 'utf8'), /index-new\.js/);
  assert.equal(await readFile(join(fixture.landing, 'privacy.html'), 'utf8'), 'new privacy');
  assert.equal(await readFile(`${fixture.spa}.bak/index.html`, 'utf8'), 'old spa');
  assert.equal(await readFile(`${fixture.landing}.bak/privacy.html`, 'utf8'), 'old privacy');

  assert.equal(runSwitch(fixture, 'rollback').status, 0);
});

for (const moveNumber of [1, 2, 3, 4]) {
  test(`activate retry self-heals after SIGKILL following rename ${moveNumber}`, async () => {
    const fixture = await createFixture();
    const killingMv = await createKillAfterMv(fixture, moveNumber);

    const interrupted = runSwitch(fixture, 'activate', { VULTR_WEB_MV_BIN: killingMv });
    assert.equal(interrupted.signal, 'SIGKILL');

    await restageCandidate(fixture);
    const retry = runSwitch(fixture);
    assert.equal(retry.status, 0, retry.stderr);
    assert.match(await readFile(join(fixture.spa, 'index.html'), 'utf8'), /index-new\.js/);
    assert.equal(await readFile(join(fixture.landing, 'privacy.html'), 'utf8'), 'new privacy');
    assert.equal(await readFile(`${fixture.spa}.bak/index.html`, 'utf8'), 'old spa');
    assert.equal(await readFile(`${fixture.landing}.bak/privacy.html`, 'utf8'), 'old privacy');
  });
}
