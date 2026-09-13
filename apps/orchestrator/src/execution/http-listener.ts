import { type RequestListener, createServer } from 'node:http';

/** Receipt of the original Node listener, not application/process drain proof. */
export function createHttpListener(app: RequestListener, port: number) {
  const server = createServer(app);
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  let bound = false;
  const ready = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void ready.catch(() => {});
  server.once('listening', () => {
    bound = true;
    resolve();
  });
  server.on('error', () => reject(new Error('HTTP_LISTEN_UNPROVEN')));
  try {
    server.listen(port);
  } catch {
    reject(new Error('HTTP_LISTEN_UNPROVEN'));
  }
  let closing: Promise<void> | undefined;
  return {
    server,
    ready,
    close(): Promise<void> {
      if (closing) return closing;
      closing = (async () => {
        // A close during pending bind must not return before that bind settles.
        await ready.catch(() => {});
        if (!bound && !server.listening) return;
        await new Promise<void>((yes, no) => server.close((error) => (error ? no(error) : yes())));
      })();
      return closing;
    },
  };
}
