import type { FileChooser, Page } from 'playwright';

type Receiver = (chooser: FileChooser) => void;
interface Receivers {
  manual?: Receiver;
  action?: Receiver;
  listener: Receiver;
  close: () => void;
}
const receivers = new WeakMap<Page, Receivers>();

/** One native listener per owned Page. The current host action takes precedence over Home UI. */
function register(page: Page, receiver: Receiver, kind: 'manual' | 'action'): () => void {
  let entry = receivers.get(page);
  if (!entry) {
    entry = {
      listener: (chooser) => {
        (entry?.action ?? entry?.manual)?.(chooser);
      },
      close: () => {
        page.off('filechooser', entry!.listener);
        receivers.delete(page);
      },
    };
    receivers.set(page, entry);
    page.on('filechooser', entry.listener);
    page.once('close', entry.close);
  }
  if (entry[kind]) throw new Error('browser_file_chooser_receiver_busy');
  entry[kind] = receiver;
  const original = entry;
  return () => {
    if (original[kind] !== receiver) return;
    delete original[kind];
    if (!original.manual && !original.action) {
      page.off('filechooser', original.listener);
      page.off('close', original.close);
      if (receivers.get(page) === original) receivers.delete(page);
    }
  };
}

/** Only a server-owned personal Home page registers a persistent manual receiver. */
export function watchBrowserFileChoosers(page: Page, receiver: Receiver): () => void {
  return register(page, receiver, 'manual');
}
export function receiveActionFileChoosers(page: Page, receiver: Receiver): () => void {
  return register(page, receiver, 'action');
}
