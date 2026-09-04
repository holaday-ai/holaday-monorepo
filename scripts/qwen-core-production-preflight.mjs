import { readFileSync } from 'node:fs';

export function evaluateQwenCorePreflight(input) {
  const failures = [];
  if (input.runtimePolicy !== 'qwen_only') failures.push('runtime_policy');
  if (
    !Array.isArray(input.healthChecks) ||
    input.healthChecks.length === 0 ||
    input.healthChecks.some((check) => check.httpStatus !== 200 || check.status !== 'ok')
  ) {
    failures.push('health_checks');
  }
  if (input.legacyProviderRequests !== 0) failures.push('legacy_provider_requests');
  if (input.crossRegionRequests !== 0) failures.push('cross_region_requests');
  if (input.coreProbeFailures !== 0) failures.push('core_probe_failures');
  if (input.stuckTasks !== 0) failures.push('stuck_tasks');
  if (!Number.isFinite(input.p95ShortCallLatencyMs) || input.p95ShortCallLatencyMs > 5_000) {
    failures.push('short_call_p95_latency');
  }
  const metrics = input.verifierMetrics ?? {};
  if (!Number.isFinite(metrics.severeIssueRecall) || metrics.severeIssueRecall < 0.95) {
    failures.push('verifier_severe_issue_recall');
  }
  if (
    !Number.isFinite(metrics.correctAnswerFalseRejectionRate) ||
    metrics.correctAnswerFalseRejectionRate > 0.02
  ) {
    failures.push('verifier_false_rejection_rate');
  }
  if (metrics.deterministicFailToPass !== 0) failures.push('verifier_monotonicity');
  if (
    !Number.isFinite(metrics.structuredOutputValidity) ||
    metrics.structuredOutputValidity < 0.99
  ) {
    failures.push('verifier_structured_output');
  }
  return { status: failures.length === 0 ? 'pass' : 'fail', failures };
}

function parseInputPath(argv) {
  const index = argv.indexOf('--input');
  if (index < 0 || !argv[index + 1]) return null;
  return argv[index + 1];
}

if (process.argv[1]?.endsWith('qwen-core-production-preflight.mjs')) {
  try {
    const inputPath = parseInputPath(process.argv);
    if (!inputPath) throw new Error('missing input');
    const input = JSON.parse(readFileSync(inputPath, 'utf8'));
    const result = evaluateQwenCorePreflight(input);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status !== 'pass') process.exitCode = 1;
  } catch {
    process.stdout.write(`${JSON.stringify({ status: 'fail', failures: ['invalid_input'] })}\n`);
    process.exitCode = 1;
  }
}
