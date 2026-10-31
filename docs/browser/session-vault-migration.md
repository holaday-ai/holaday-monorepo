# Session vault v1: activation and migration gates

This candidate is default-off. Neither production activation nor any database mutation was performed for this PR. The application intentionally rejects enabled flags until a formal KeyProvider is supplied; the ephemeral provider refuses non-test environments. Site login probes are explicit trusted adapters, with no production adapters selected here.

## Storage and authorization

`0067_browser_session_vault.sql` adds one per-user vault row containing grant metadata and authenticated encrypted snapshots. SQL operations lock the active user before the vault row and compare the row revision. The runtime checks owner, grant status, expiry and the writer lease before decrypting, each network request, and saving. A tombstone clears ciphertext and increments the grant version; older workers cannot write it back. Contexts are isolated incognito contexts loaded in memory, with no plaintext storage-state files or shared active profile directory. The test store and test keys are unavailable outside `NODE_ENV=test`.

The imported grant lasts at most seven days, shortened by actual cookie expiry. Profiles additionally have seven-day idle and thirty-day absolute ceilings, always bounded by the site grant. This candidate does not extend the seven-day import grant when persisting a profile; the user must authorize a new import. Multiple connected site grants require future explicit task-site selection and currently fail closed. IndexedDB is not imported; partition metadata is preserved at ingress but partitioned sessions are rejected by the cloud adapter rather than flattened.

## Legacy data

Legacy unscoped cookie imports cannot acquire consent retroactively. Automatic extension sync, `/cookies/sync` ingestion, and pool injection are retired regardless of the new flags. The compatibility writer only writes ciphertext and sets the legacy plaintext column to NULL. The compatibility reader never reads or falls back to that column. New explicit consent, revoke and clear delete the owner's old pending queue. No historical task records are touched.

Before activation an operator must apply the additive schema in a nonproduction clone, verify constraints/transaction isolation, and rehearse failure/retry. Inventory old cookie rows using counts and identifiers only. Purge the dedicated legacy queue rather than convert it to authorized sessions. Verify the queue contains no recoverable values, and then review a separate migration dropping retired plaintext columns. No bulk purge or drop is run by this PR. Apply normal retention and destruction to database snapshots, exports, replicas and backups; do not restore old queue data into active runtime. Backup restore must honor deletion/tombstone records and the current active-owner/consent ledger before making any snapshot decryptable. Backup/key-retirement controls require operator acceptance before enabling a cohort.

## Keys and rollout

The formal provider must bind all of userId, origin, grantId, purpose and version in its encryption context, enforce least-privilege wrapping/decryption access, and redact provider errors. `rewrapEnvelope` supports authenticated wrapping-key rotation without changing the encrypted payload. Persist rotations using the same locked CAS transaction; discard old ciphertext/wrapped keys per the accepted backup retention policy. Never enable a plaintext rollback writer.

Activate only after provider, trusted site probes, SQL integration and backup/deletion gates are accepted. Validate on a synthetic cohort first. Turning either feature off removes its capability; disable both to stop all vault operations. Revocation/clear block future imports and decrypts, close active contexts and erase recoverable snapshots in the live vault. Account closure also blocks the active-owner check and deletes the vault. Do not promise imported sessions will survive cloud IP/device changes or bypass challenges.
