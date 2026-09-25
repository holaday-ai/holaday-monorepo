import { type ApplicationBoot, startApplicationBoot } from './execution/application-boot.js';
import { randomBytes } from 'node:crypto';
import { createOrdinaryApplication } from './execution/ordinary-application.js';
import {
  ORDINARY_MAINTENANCE_DIRECTORY,
  resolveOrdinaryMaintenanceMode,
} from './execution/ordinary-maintenance-mode.js';

// Capture routing before dotenv/application imports. Presence is not authority:
// partial or invalid metadata still enters the real boot verifier and fails shut.
const controlled =
  process.env.HOLADAY_POOL_BOOT !== undefined || process.env.HOLADAY_POOL_CANDIDATE !== undefined;
const entryEnvironment = { ...process.env };

export async function launchApplication(): Promise<void> {
  // This read is before application/env imports and outside legacy fatal fallback.
  const maintenanceEnabled = resolveOrdinaryMaintenanceMode(entryEnvironment);
  let boot: ApplicationBoot | undefined;
  let ordinary: ReturnType<typeof createOrdinaryApplication> | undefined;
  let application:
    | Awaited<ReturnType<typeof import('./application-main.js').startApplication>>
    | undefined;
  try {
    if (maintenanceEnabled)
      ordinary = createOrdinaryApplication({
        directory: ORDINARY_MAINTENANCE_DIRECTORY,
        identity: {
          candidate: entryEnvironment.HOLADAY_ORDINARY_CANDIDATE!,
          bootId: randomBytes(16).toString('hex'),
        },
        // Task 5 supplies the production schema/record/service probes. Never an
        // empty success callback while that deployment integration is incomplete.
        async verifyReady() {
          throw new Error('MAINTENANCE_READINESS_UNPROVEN');
        },
      });
    if (controlled) boot = await startApplicationBoot('/var/lib/holaday/execution-drain');
    const { startApplication } = await import('./application-main.js');
    application = ordinary
      ? await startApplication(undefined, ordinary)
      : await startApplication(boot);
    if (ordinary) await ordinary.startControl();
  } catch {
    // A failed close remains failed; never re-import or start a legacy fallback.
    if (boot) await boot.close();
    if (ordinary) {
      if (application) await application.shutdown('startup-failed');
      else ordinary.closeState();
    }
    if (!controlled && !maintenanceEnabled) {
      // Ordinary startup can already own listeners/timers. Preserve the legacy
      // fatal-start exit; exitCode alone leaves a half-started service alive.
      process.stderr.write('APPLICATION_START_UNPROVEN\n');
      process.exit(1);
    }
    throw new Error('APPLICATION_START_UNPROVEN');
  }
}
