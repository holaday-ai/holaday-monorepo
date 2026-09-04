export function evaluateQwenInitialCutover(input) {
  const failures = [];
  if (!input.candidateQwenOnly) failures.push('candidate_not_qwen_only');

  if (input.rollbackQwenOnly) {
    return {
      status: failures.length === 0 ? 'pass' : 'fail',
      mode: 'normal',
      allowLegacyEmergencyRollback: false,
      failures,
    };
  }

  if (!input.allowInitialCutover) failures.push('qwen_only_rollback_missing');
  if (input.rolloutMode !== 'off') failures.push('initial_cutover_requires_rollout_off');
  return {
    status: failures.length === 0 ? 'pass' : 'fail',
    mode: 'initial',
    allowLegacyEmergencyRollback: failures.length === 0,
    failures,
  };
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1]?.endsWith('qwen-initial-cutover-policy.mjs')) {
  const result = evaluateQwenInitialCutover({
    allowInitialCutover: readArgument('--allow-initial') === '1',
    rollbackQwenOnly: readArgument('--rollback-qwen') === '1',
    candidateQwenOnly: readArgument('--candidate-qwen') === '1',
    rolloutMode: readArgument('--rollout-mode') ?? '',
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== 'pass') process.exitCode = 1;
}
