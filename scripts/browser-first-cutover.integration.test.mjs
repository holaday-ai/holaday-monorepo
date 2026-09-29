import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import test from 'node:test';
import { promisify } from 'node:util';

// Explicit Linux QA entry; exclude *.integration.test.mjs from Mac regression. The
// runtime fixture uses PM2 and fixed /opt paths ONLY inside its private-PID
// disposable container. No production configuration, database or credentials.
// This covers transition -> site -> physical retirement -> failure retention.
// Full backup/migration/new-application/open success is intentionally NOT proven.
// One case per fresh container: fixed protected paths are deliberately retained
// after a failed transition, never deleted to make the next scenario pass.
const run = promisify(execFile);
const scenario = process.env.CUTOVER_QA_LOST_EFFECT_CASE;
const knownEffect = scenario === 'known';
const fullHost = scenario === 'host';
test(
  fullHost
    ? 'original host prepares its own candidate and journal before physical retirement and backup refusal'
    : knownEffect
      ? 'identified lost external effect blocks retirement without replay'
      : 'lost legacy response remains unknown through retirement and restore failure',
  { timeout: fullHost ? 720000 : 90000 },
  async () => {
    assert.equal(process.platform, 'linux', 'requires the existing isolated Linux QA image');
    assert.ok(
      ['unknown', 'known', 'host'].includes(scenario),
      'select unknown, known or host in a fresh QA attempt; host needs the prepared Git/build environment',
    );
    assert.equal(process.getuid(), 0);
    await access('/.dockerenv');
    const result = await run(
      process.execPath,
      [
        '/source/fixtures/browser-registration-removal-linux.mjs',
        knownEffect ? '--execution-site-known-effect' : '--execution-site-lost-effect',
      ],
      {
        timeout: fullHost ? 660000 : 80000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, CUTOVER_QA_HOST: fullHost ? '1' : '0' },
      },
    );
    const lines = result.stdout
      .split('\n')
      .filter((line) => line.startsWith('QA_LOST_EFFECT_RESULT '));
    assert.equal(lines.length, 1);
    const proof = JSON.parse(lines[0].slice('QA_LOST_EFFECT_RESULT '.length));
    assert.deepEqual(
      { ...proof, riskDigest: undefined },
      {
        scope: 'retirement-and-failure-only',
        knownEffect,
        phase: knownEffect ? 'legacy_interruption_accepted' : 'backup_verified',
        effectCount: 1,
        riskDigest: undefined,
        releaseReady: false,
        ...(fullHost ? { originalHost: true, nativeCandidatePreparation: true } : {}),
      },
    );
    assert.match(proof.riskDigest, /^[a-f0-9]{64}$/);
  },
);
