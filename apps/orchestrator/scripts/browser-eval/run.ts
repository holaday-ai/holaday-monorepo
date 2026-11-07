/** --local-synthetic never imports model wiring or reads provider configuration. */
if (process.argv.includes('--local-synthetic')) {
  const { runLocalSynthetic } = await import('./run-synthetic.js');
  await runLocalSynthetic();
} else {
  await import('./run-model.js');
}
export {};
