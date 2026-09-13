import { BrokerBootSession } from '../browser-pool/broker-boot-session.js';
import { startDrainControlServer } from './drain-control-server.js';
import { DrainController } from './drain-controller.js';

/** Internal startup only. The entrypoint supplies the installation's fixed path;
 * requests/environment configuration cannot select another state directory. */
export async function startApplicationBoot(directory: string) {
  const broker = BrokerBootSession.start();
  let controller: DrainController | undefined;
  try {
    await broker.ready;
    const identity = BrokerBootSession.identity(broker);
    // No synthetic authorizeOpen callback. The real maintenance integration is
    // a separate release gate; native registration alone never admits work.
    controller = new DrainController(directory, identity);
    const originalController = controller;
    const server = await startDrainControlServer(directory, controller);
    let closing: Promise<void> | undefined;
    return Object.freeze({
      broker,
      controller: originalController,
      close(): Promise<void> {
        if (closing) return closing;
        let resolve!: () => void;
        let reject!: (error: unknown) => void;
        closing = new Promise<void>((yes, no) => {
          resolve = yes;
          reject = no;
        });
        const invoke = <T>(action: () => Promise<T>): Promise<T> => {
          try {
            return action();
          } catch (error) {
            return Promise.reject(error);
          }
        };
        // Publish first, then revoke synchronously. A failed/slow control close
        // must neither keep the boot identity live nor skip the original broker.
        const brokerClosing = invoke(() => broker.close());
        const controlClosing = invoke(() => server.close());
        void Promise.allSettled([brokerClosing, controlClosing]).then(
          ([brokerResult, controlResult]) => {
            if (
              brokerResult.status === 'rejected' ||
              controlResult.status === 'rejected' ||
              !controlResult.value.released ||
              controlResult.value.retainedListener
            )
              reject(new Error('APPLICATION_BOOT_CLOSE_UNPROVEN'));
            else resolve();
          },
        );
        return closing;
      },
    });
  } catch {
    controller?.shutdown();
    await broker.close().catch(() => {});
    throw new Error('APPLICATION_BOOT_UNPROVEN');
  }
}

export type ApplicationBoot = Awaited<ReturnType<typeof startApplicationBoot>>;
