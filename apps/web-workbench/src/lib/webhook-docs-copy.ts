export function webhookCurlExample(webhookUrl: string): string {
  return `curl -X POST ${webhookUrl} \\
  -H "Authorization: Bearer hd_live_xxxxxxxxxxxxxxxxxxxxxxxx" \\
  -H "Idempotency-Key: my-unique-key-001" \\
  -H "Content-Type: application/json" \\
  -d '{"prompt":"帮我查一下今天的科技新闻"}'`;
}
