import { startOrdinaryMaintenanceControl } from './ordinary-maintenance-control.js';
import { createOrdinaryMaintenanceStore } from './ordinary-maintenance-store.js';
import { type MaintenanceIdentity, OrdinaryMaintenance } from './ordinary-maintenance.js';

/** Ordinary-mode lifecycle only; never an ApplicationBoot or native authorization. */
export interface OrdinaryApplicationHooks {
  prepareServing(): Promise<void>;
  startProducers(): void;
  stopProducers(): Promise<void>;
  verifyRetainedQueue(): Promise<void>;
}
export interface OrdinaryApplication {
  readonly coordinator: OrdinaryMaintenance;
  bind(hooks: OrdinaryApplicationHooks): void;
  closeControl(): Promise<void>;
  closeState(): void;
}

export function createOrdinaryApplication(input: {
  directory: string;
  identity: MaintenanceIdentity;
  verifyReady(identity: MaintenanceIdentity): Promise<void>;
}): OrdinaryApplication & { startControl(): Promise<void> } {
  const store = createOrdinaryMaintenanceStore(input.directory, input.identity);
  let hooks: OrdinaryApplicationHooks | undefined;
  let control: Promise<{ close(): Promise<void> }> | undefined;
  let closing: Promise<void> | undefined;
  let controlClosed = false;
  let stateClosed = false;
  const bound = () => {
    if (!hooks) throw new Error('MAINTENANCE_APPLICATION_UNBOUND');
    return hooks;
  };
  const coordinator = new OrdinaryMaintenance({
    identity: input.identity,
    journal: store,
    checks: {
      verifyReady: async (identity) => {
        bound();
        await input.verifyReady(identity);
      },
      prepareServing: () => bound().prepareServing(),
      startProducers: () => bound().startProducers(),
      stopProducers: async () => {
        await hooks?.stopProducers();
      },
      verifyRetainedQueue: () => bound().verifyRetainedQueue(),
    },
  });
  return {
    coordinator,
    bind(value) {
      if (
        hooks ||
        closing ||
        stateClosed ||
        [
          value.prepareServing,
          value.startProducers,
          value.stopProducers,
          value.verifyRetainedQueue,
        ].some((fn) => typeof fn !== 'function')
      )
        throw new Error('MAINTENANCE_APPLICATION_BINDING');
      hooks = value;
    },
    async startControl() {
      bound();
      if (closing || stateClosed) throw new Error('MAINTENANCE_APPLICATION_CLOSED');
      control ??= startOrdinaryMaintenanceControl({ directory: input.directory, coordinator });
      await control;
    },
    closeControl() {
      closing ??= Promise.resolve().then(async () => {
        if (control) await (await control).close();
        else await coordinator.beginMaintenance();
        controlClosed = true;
      });
      return closing;
    },
    closeState() {
      if (stateClosed) return;
      const state = coordinator.snapshot();
      if (
        (control && !controlClosed) ||
        state.mode !== 'closed' ||
        state.needsReconciliation ||
        !state.counts.idle
      )
        throw new Error('MAINTENANCE_APPLICATION_CLOSE_UNPROVEN');
      store.close();
      stateClosed = true;
    },
  };
}
