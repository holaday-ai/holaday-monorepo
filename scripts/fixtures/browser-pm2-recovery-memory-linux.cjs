// Bounded regression using cached PM2 6.0.14 Worker + Utility, adapted from
// the controller's memory-policy diagnostic. Parent runs this in its existing
// disposable Linux source image. No PM2 CLI/God/daemon or real reload is started;
// monitoring/reload effects and the interval are deterministic substitutes.
const assert = require('node:assert/strict');
const fs = require('node:fs');

assert.equal(process.platform, 'linux');
fs.accessSync('/.dockerenv');
assert.equal(require('/opt/node22/lib/node_modules/pm2/package.json').version, '6.0.14');
process.env.PM2_DISABLE_VERSION_CHECK = 'true';
const installWorker = require('/opt/node22/lib/node_modules/pm2/lib/Worker.js');
const utility = require('/opt/node22/lib/node_modules/pm2/lib/Utility.js');
const workerIntervalMs = require('/opt/node22/lib/node_modules/pm2/constants.js').WORKER_INTERVAL;
assert.equal(workerIntervalMs, 30000, 'reviewed cached Worker interval');

async function probe(config) {
  let run;
  let monitorReads = 0;
  let reloads = 0;
  const god = {
    clusters_db: { 6: { pm2_env: config } },
    getMonitorData: (_, done) => {
      monitorReads++;
      done(null, [{ pm2_env: config, monit: { memory: 1024 } }]);
    },
    reloadProcessId: (input, done) => {
      assert.deepEqual(input, { id: 6 });
      reloads++;
      done(null, {});
    },
  };
  installWorker(god);
  const originalInterval = global.setInterval;
  global.setInterval = (callback, intervalMs) => {
    assert.equal(run, undefined, 'one intercepted worker interval');
    assert.equal(intervalMs, workerIntervalMs, 'actual Worker uses the cached constant');
    run = callback;
    return 1;
  };
  try {
    god.Worker.start();
  } finally {
    global.setInterval = originalInterval;
  }
  assert.equal(typeof run, 'function');
  run();
  assert.equal(monitorReads, 1);
  assert.equal(god.Worker.is_running, false);
  return reloads;
}

function stoppedConfig() {
  return {
    pm_id: 6,
    autorestart: false,
    axm_options: {},
    max_memory_restart: 500,
    env: { DISPLAY: ':98' },
    DISPLAY: ':98',
    restart_time: 19,
    retained: { unknown: ['keep'] },
  };
}

function mergeDeletion(config) {
  const wire = JSON.parse(
    JSON.stringify({ env: { current_conf: { max_memory_restart: 'null' } } }),
  );
  // Exact merge ordering in restartProcessId then executeApp. Actual Utility
  // performs the merge/deletion; no copied implementation is under test.
  utility.extend(config.env, wire.env);
  utility.extendExtraConfig({ pm2_env: config }, wire);
  assert.equal(Object.hasOwn(config, 'max_memory_restart'), false);
  utility.extend(config, config.env);
}

(async () => {
  for (const value of [0, null, false]) {
    const config = stoppedConfig();
    config.max_memory_restart = value;
    assert.equal(await probe(config), 1, `${JSON.stringify(value)} still requests reload`);
  }
  const absent = { pm_id: 6, autorestart: false, axm_options: {} };
  assert.equal(await probe(absent), 0);

  const removed = stoppedConfig();
  mergeDeletion(removed);
  assert.deepEqual(removed, {
    pm_id: 6,
    autorestart: false,
    axm_options: {},
    env: { DISPLAY: ':98' },
    DISPLAY: ':98',
    restart_time: 19,
    retained: { unknown: ['keep'] },
  });
  assert.equal(await probe(removed), 0);

  const shadowed = stoppedConfig();
  shadowed.env.max_memory_restart = 0;
  mergeDeletion(shadowed);
  assert.equal(Object.hasOwn(shadowed, 'max_memory_restart'), true);
  assert.equal(shadowed.max_memory_restart, 0);
  assert.equal(await probe(shadowed), 1, 'env flattening reintroduces the unsafe threshold');
  console.log(
    JSON.stringify({
      source: 'actual PM2 6.0.14 Worker and Utility',
      workerIntervalMs,
      simulatedMemoryBytes: 1024,
      autorestart: false,
      zeroLimitReloads: 1,
      nullLimitReloads: 1,
      falseLimitReloads: 1,
      absentLimitReloads: 0,
      wireStringNullDeletedLimit: true,
      removedLimitReloads: 0,
      nestedEnvShadowReloads: 1,
      otherConfigAndHistoricalCountPreserved: true,
      daemonStarted: false,
      actualProcessesRestarted: 0,
    }),
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
