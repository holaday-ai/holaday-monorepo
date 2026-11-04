import { writeFile } from 'node:fs/promises';
import { TaskJournal } from '../journal.js';
const [root, marker] = process.argv.slice(2);
if (!root || !marker || process.env.NODE_ENV !== 'test') throw new Error('fixture_only');
const journal = await TaskJournal.open(root, {
  taskId: 'crash-task',
  accountId: 'fixture-account',
  keyId: 'fixture-key',
});
await journal.exclusive(async (state) => {
  state.intents['fixture-quote'] = {
    binding: 'fixture-binding',
    idempotencyKey: 'same-intent',
    maximum: 100,
    phase: 'submitting',
  };
  await journal.save(state);
  await writeFile(marker, journal.path, { mode: 0o600 });
  await new Promise(() => {
    setInterval(() => {}, 1000);
  });
});
