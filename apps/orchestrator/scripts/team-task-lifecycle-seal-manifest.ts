import { resolveLifecycleCanarySealCliConfiguration } from '../src/team-work-items/team-task-lifecycle-canary-cli.js';
import { sealLifecycleCanaryCandidateFiles } from '../src/team-work-items/team-task-lifecycle-canary-runner.js';

async function main(): Promise<void> {
  try {
    const configuration = resolveLifecycleCanarySealCliConfiguration(
      process.argv.slice(2),
      process.getuid?.(),
    );
    await sealLifecycleCanaryCandidateFiles(configuration);
    console.log(
      'TEAM_TASK_LIFECYCLE_CANARY_SEAL status=sealed syntheticUsers=4 syntheticOrganizations=2',
    );
  } catch {
    console.error('TEAM_TASK_LIFECYCLE_CANARY_SEAL status=error');
    process.exitCode = 1;
  }
}

await main();
