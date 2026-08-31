import { isAbsolute, resolve } from 'node:path';
import {
  createLifecycleCanaryUnsignedAttestation,
  lifecycleCanaryAttestationSigningPayload,
  loadLifecycleCanaryCandidate,
} from '../src/team-work-items/team-task-lifecycle-canary-runner.js';

async function main(): Promise<void> {
  try {
    const [candidatePath, operatorSlot, operatorPrincipal, confirmedAt] = process.argv.slice(2);
    if (
      process.getuid?.() !== 998 ||
      process.argv.slice(2).length !== 4 ||
      !candidatePath ||
      !isAbsolute(candidatePath) ||
      (operatorSlot !== 'primary' && operatorSlot !== 'secondary') ||
      !operatorPrincipal ||
      !confirmedAt
    ) {
      throw new Error('invalid canary attestation payload request');
    }
    const candidate = await loadLifecycleCanaryCandidate(resolve(candidatePath));
    const unsignedAttestation = createLifecycleCanaryUnsignedAttestation({
      candidate,
      operatorSlot,
      operatorPrincipal,
      confirmedAt,
    });
    process.stdout.write(
      `${lifecycleCanaryAttestationSigningPayload(unsignedAttestation).toString('utf8')}\n`,
    );
  } catch {
    console.error('TEAM_TASK_LIFECYCLE_ATTESTATION_PAYLOAD status=error');
    process.exitCode = 1;
  }
}

await main();
