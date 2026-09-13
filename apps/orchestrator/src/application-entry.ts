import { type ApplicationBoot, startApplicationBoot } from './execution/application-boot.js';

// Capture routing before dotenv/application imports. Presence is not authority:
// partial or invalid metadata still enters the real boot verifier and fails shut.
const controlled =
  process.env.HOLADAY_POOL_BOOT !== undefined || process.env.HOLADAY_POOL_CANDIDATE !== undefined;

export async function launchApplication(): Promise<void> {
  let boot: ApplicationBoot | undefined;
  try {
    if (controlled) boot = await startApplicationBoot('/var/lib/holaday/execution-drain');
    const { startApplication } = await import('./application-main.js');
    await startApplication(boot);
  } catch {
    // A failed close remains failed; never re-import or start a legacy fallback.
    if (boot) await boot.close();
    throw new Error('APPLICATION_START_UNPROVEN');
  }
}
