export function createMaintenanceBackground(): {
  register(name: string, producer: { start(): void; stop(): Promise<void> }): void;
  startOnce(): void;
  stopAll(): Promise<void>;
} {
  type Producer = { start(): void; stop(): Promise<void> };
  const producers = new Map<string, Producer>();
  const started: Producer[] = [];
  let state: 'new' | 'running' | 'failed' | 'stopped' = 'new';
  let stopping: Promise<void> | undefined;
  return {
    register(name, producer) {
      if (state !== 'new' || !name || producers.has(name))
        throw new Error('MAINTENANCE_BACKGROUND_REGISTRATION');
      producers.set(name, producer);
    },
    startOnce() {
      if (state === 'running') return;
      if (state !== 'new') throw new Error('MAINTENANCE_BACKGROUND_STOPPED');
      state = 'running';
      try {
        for (const producer of producers.values()) {
          if (state !== 'running') throw new Error('MAINTENANCE_BACKGROUND_STOPPED');
          // A start that throws may already have created a timer.
          started.push(producer);
          producer.start();
        }
      } catch (error) {
        if (state === 'running') state = 'failed';
        throw error;
      }
    },
    stopAll() {
      if (stopping) return stopping;
      state = 'stopped';
      // Publish the original promise before calling reentrant producer code.
      stopping = Promise.resolve().then(async () => {
        const results = await Promise.allSettled(
          [...started].reverse().map((producer) => Promise.resolve().then(() => producer.stop())),
        );
        if (results.some((result) => result.status === 'rejected'))
          throw new Error('MAINTENANCE_BACKGROUND_UNPROVEN');
      });
      return stopping;
    },
  };
}
