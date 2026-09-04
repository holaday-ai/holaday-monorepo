import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORBIDDEN_MODEL_PATTERNS = Object.freeze({
  new_anthropic: /new\s+Anthropic\s*\(/g,
  new_openai: /new\s+OpenAI\s*\(/g,
  google_model_endpoint: /generativelanguage\.googleapis\.com/g,
});

export function scanProductionModelImports({
  files,
  roots = ['src/index.ts'],
  inventory = { entries: [] },
}) {
  const fileMap = new Map(files.map((file) => [normalizePath(file.path), file.text]));
  const inventoryEntries = new Map(
    (inventory.entries ?? []).map((entry) => [normalizePath(entry.path), entry]),
  );
  const reachable = collectReachable(fileMap, roots);
  const violations = [];

  for (const path of [...reachable].sort()) {
    if (inventoryEntries.has(path)) {
      violations.push({ path, rule: 'production_reaches_legacy_inventory' });
    } else if (isDormantPath(path)) {
      violations.push({ path, rule: 'production_reaches_dormant' });
    }
  }

  for (const [path, text] of [...fileMap.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (isExcludedSource(path)) continue;
    const counts = countForbiddenPatterns(text);
    const activePatterns = Object.entries(counts).filter(([, count]) => count > 0);
    const inventoryEntry = inventoryEntries.get(path);

    if (inventoryEntry) {
      const expected = inventoryEntry.patterns ?? {};
      const patternNames = new Set([...Object.keys(expected), ...Object.keys(counts)]);
      for (const pattern of [...patternNames].sort()) {
        const expectedCount = Number(expected[pattern] ?? 0);
        const actualCount = Number(counts[pattern] ?? 0);
        if (expectedCount !== actualCount) {
          violations.push({
            path,
            rule: 'legacy_inventory_mismatch',
            pattern,
            expected: expectedCount,
            actual: actualCount,
          });
        }
      }
      continue;
    }

    for (const [pattern] of activePatterns) {
      violations.push({
        path,
        rule: reachable.has(path) ? 'legacy_model_client' : 'unregistered_legacy_inventory',
        pattern,
      });
    }
  }

  for (const [path, entry] of inventoryEntries) {
    if (!fileMap.has(path)) {
      violations.push({ path, rule: 'legacy_inventory_missing_file' });
    }
    if (entry.status !== 'disabled_by_qwen_top_boundary' && !isDormantPath(path)) {
      violations.push({ path, rule: 'legacy_inventory_invalid_status' });
    }
  }

  return {
    status: violations.length === 0 ? 'pass' : 'fail',
    reachableFiles: reachable.size,
    inventoriedFiles: inventoryEntries.size,
    violations,
    inventory,
  };
}

export function evaluateQwenGoldResults(results) {
  const severe = results.filter((result) => result.expected === 'severe');
  const correct = results.filter((result) => result.expected === 'pass');
  const severeIssueRecall =
    severe.length === 0
      ? 1
      : severe.filter((result) => result.actual === 'reject').length / severe.length;
  const correctAnswerFalseRejectionRate =
    correct.length === 0
      ? 0
      : correct.filter((result) => result.actual === 'reject').length / correct.length;
  const deterministicFailToPass = results.filter(
    (result) => result.deterministicBefore === 'fail' && result.deterministicAfter === 'pass',
  ).length;
  const structuredOutputValidity =
    results.length === 0
      ? 0
      : results.filter((result) => result.structured === true).length / results.length;
  const status =
    severeIssueRecall >= 0.95 &&
    correctAnswerFalseRejectionRate <= 0.02 &&
    deterministicFailToPass === 0 &&
    structuredOutputValidity >= 0.99
      ? 'pass'
      : 'fail';

  return {
    status,
    total: results.length,
    severeIssueRecall,
    correctAnswerFalseRejectionRate,
    deterministicFailToPass,
    structuredOutputValidity,
  };
}

function collectReachable(fileMap, roots) {
  const reachable = new Set();
  const queue = roots.map(normalizePath);
  while (queue.length > 0) {
    const path = queue.shift();
    if (!path || reachable.has(path) || !fileMap.has(path)) continue;
    reachable.add(path);
    const text = fileMap.get(path);
    for (const specifier of importSpecifiers(text)) {
      const resolved = resolveImport(fileMap, path, specifier);
      if (resolved && !reachable.has(resolved)) queue.push(resolved);
    }
  }
  return reachable;
}

function importSpecifiers(text) {
  const specifiers = [];
  const patterns = [
    /import\s+(?!type\b)(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /export\s+(?!type\b)[^'"()]*?\s+from\s+['"]([^'"]+)['"]/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match[1]?.startsWith('.')) specifiers.push(match[1]);
    }
  }
  return specifiers;
}

function resolveImport(fileMap, importer, specifier) {
  const base = posix.normalize(posix.join(posix.dirname(importer), specifier));
  const withoutJs = base.replace(/\.(?:m?js|cjs)$/u, '');
  const candidates = [
    base,
    `${withoutJs}.ts`,
    `${withoutJs}.tsx`,
    `${withoutJs}/index.ts`,
    `${withoutJs}/index.tsx`,
  ];
  return candidates.find((candidate) => fileMap.has(candidate)) ?? null;
}

function countForbiddenPatterns(text) {
  return Object.fromEntries(
    Object.entries(FORBIDDEN_MODEL_PATTERNS).map(([name, pattern]) => {
      pattern.lastIndex = 0;
      return [name, [...text.matchAll(pattern)].length];
    }),
  );
}

function isDormantPath(path) {
  return path.includes('/dormant/');
}

function isExcludedSource(path) {
  return /(?:\.test|\.integration\.test)\.[cm]?[jt]sx?$/u.test(path) || path.includes('/scripts/');
}

function normalizePath(path) {
  return String(path).replaceAll('\\', '/').replace(/^\.\//u, '');
}

function readSourceFiles(srcDir) {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        walk(path);
      } else if (/\.tsx?$/u.test(name)) {
        files.push({
          path: normalizePath(relative(dirname(srcDir), path)),
          text: readFileSync(path, 'utf8'),
        });
      }
    }
  };
  walk(srcDir);
  return files;
}

if (process.argv.includes('--run')) {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const appDir = resolve(scriptDir, '..');
  const inventoryPath = join(scriptDir, 'fixtures/qwen-legacy-migration-inventory.json');
  const goldPath = join(scriptDir, 'fixtures/qwen-core-gold.json');
  const inventory = existsSync(inventoryPath)
    ? JSON.parse(readFileSync(inventoryPath, 'utf8'))
    : { entries: [] };
  const gold = existsSync(goldPath) ? JSON.parse(readFileSync(goldPath, 'utf8')) : { cases: [] };
  const report = scanProductionModelImports({
    files: readSourceFiles(join(appDir, 'src')),
    roots: ['src/index.ts'],
    inventory,
  });
  const goldReport = evaluateQwenGoldResults(gold.cases ?? []);
  const status = report.status === 'pass' && goldReport.status === 'pass' ? 'pass' : 'fail';
  process.stdout.write(
    `${JSON.stringify({
      status,
      reachableFiles: report.reachableFiles,
      inventoriedFiles: report.inventoriedFiles,
      violations: report.violations,
      verifier: goldReport,
    })}\n`,
  );
  if (status !== 'pass') process.exitCode = 1;
}
