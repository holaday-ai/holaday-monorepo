# Local validation logs

These logs come from serial local execution with Node 22.23.3, one worker and a 1536 MiB heap cap. Commands and interpretation are recorded in [validation.md](../validation.md).

- `full-baseline.txt`: complete 240-scene run at 935348a4; exit 1 because the product has P1 findings.
- `calibration-followup.txt`: 27 affected scenes at ff1e30d9; exit 1 for findings and deliberate case filtering.
- `visual-repeat.txt`: 9 screenshots at ff1e30d9; exit 1 for existing geometry findings and deliberate filtering/screens-only mode.
- `framework-tests.txt`: 55/55 detector/seed tests; exit 0.
- `frontend-tests.txt`: 280 files / 2645 tests; exit 0.
- `frontend-typecheck.txt`, `frontend-lint.txt`, `frontend-build.txt`: exit 0. The build retains the existing bundle-size warning.
- Independent reproduction logs and the three red-to-green calibration regressions are separate diagnostic evidence.
- Freeze manifests are relative to the repository root and were checked after the corresponding runs. Later documentation-only commits do not change those runtime files.

Synthetic data only; these logs do not attest production behavior or deployment.

Committed text logs normalize trailing whitespace only; original byte-for-byte outputs remain in `/private/tmp/holaday-tasks/`.
