import { launchApplication } from './application-entry.js';

void launchApplication().catch(() => {
  process.stderr.write('APPLICATION_START_UNPROVEN\n');
  // Do not force-exit over original IO whose outcome is still unknown.
  process.exitCode = 1;
});
