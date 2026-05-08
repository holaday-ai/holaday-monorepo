/**
 * White-screen postmortem (1de57cc) cemented this gate: a conditional
 * React.useEffect placed AFTER `if (!authed) return` made the hook
 * count flip between renders → React error #310, whole app blank.
 * tsc + tests + manual review didn't catch it. ESLint's
 * `react-hooks/rules-of-hooks` is the authoritative checker for hook
 * ordering — pin it as `error` so CI (or `pnpm lint`) blocks the
 * push before another regression ships.
 *
 * `exhaustive-deps` stays `warn` because a stale dep is rarely a
 * white-screen — usually just a bug to fix later.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['react-hooks', '@typescript-eslint'],
  env: { browser: true, es2022: true, node: true },
  ignorePatterns: ['dist/', 'node_modules/', '*.cjs'],
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
  },
};
