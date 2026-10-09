import fs from 'node:fs';
import path from 'node:path';
import { evaluateGate } from './checks.mjs';
export function saveReport(report, out) {
  report.status = evaluateGate(report);
  fs.writeFileSync(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const esc = (x) =>
    String(x ?? '')
      .replaceAll('|', '\\|')
      .replaceAll('\n', ' ');
  const lines = [
    '# UI regression report',
    '',
    `Result: **${report.status}** · candidate \`${report.candidate}\` · seed \`${report.seed}\``,
    '',
    `Frontend source: \`${report.sourceHash}\`; build: \`${report.buildHash}\`.`,
    '',
    'Local seeded frontend/backend only. Production, paid services and real accounts are not contacted. Baseline creation is not a passed comparison.',
    '',
    `Pages: ${report.pages.length}/${report.expectedPages ?? '?'}; findings: ${report.findings.length}; coverage gaps: ${report.coverageGaps.length}.`,
    '',
    '## Findings',
    '',
    '| Severity | Route / width | Rule | Detail | Screenshot |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const f of report.findings)
    lines.push(
      `| ${f.severity} | ${esc(f.route)} / ${f.width ?? ''} | ${f.rule} | ${esc([f.control, f.detail].filter(Boolean).join(': '))} | [image](${f.screenshot ?? ''}) |`,
    );
  lines.push(
    '',
    '## Coverage gaps',
    '',
    ...report.coverageGaps.map((g) => `- ${esc(g)}`),
    '',
    '## Page and control coverage',
    '',
    '| Route | Width | Total | Passed / shared / disabled / protocol / uncovered / failed | Screenshot |',
    '| --- | --- | --- | --- | --- | --- |',
  );
  for (const p of report.pages)
    lines.push(
      `| ${esc(p.route)} | ${p.width} | ${p.controls.length} | ${['passed', 'shared-reference', 'disabled', 'protocol-link', 'uncovered', 'failed'].map((s) => p.controls.filter((c) => c.status === s || (s === 'passed' && c.status === 'idempotent')).length).join(' / ')} | [image](${p.screenshot}) |`,
    );
  lines.push(
    '',
    '## Boundary and exclusions',
    '',
    ...report.networkWhitelist.map((w) => `- ${w.rule}: ${w.reason}`),
    '',
    'Disabled controls are recorded as prerequisites, not successful actions. Static source inventory is broader than the finite runtime states. Missing runtime contracts, traversal limits and unknown routes block the gate. See README.md and known-issues.md for the interpretation of this baseline.',
    '',
  );
  fs.writeFileSync(path.join(out, 'report.md'), lines.join('\n'));
}
