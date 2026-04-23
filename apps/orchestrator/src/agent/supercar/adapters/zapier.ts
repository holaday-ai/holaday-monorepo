/**
 * Zapier adapter (Lane 4).
 *
 * Drives Zapier's "Catch Hook" / "Natural Language Actions" webhook
 * endpoint. Active only when both ZAPIER_API_KEY and a per-task
 * webhook identifier are configured — absent either and the router
 * reports unavailable.
 *
 * Only cross-platform automations that the model decides "this is a
 * Zap-shaped workflow" hit this lane. Intent classification happens
 * upstream in tasks.ts via `isCrossPlatformAutomation`.
 *
 * Zapier's hook endpoint returns immediately with a run id; the
 * actual Zap runs async. We surface the id + a short status URL so
 * the supercar summary can tell the user where to check completion.
 */

export interface ZapierTriggerResult {
  readonly ok: true;
  readonly runId?: string;
  readonly statusUrl?: string;
}

export interface ZapierAdapter {
  trigger(
    webhookPath: string,
    payload: Record<string, unknown>,
  ): Promise<ZapierTriggerResult | { readonly error: string }>;
}

export function createZapierAdapter(apiKey: string | null): ZapierAdapter | null {
  if (!apiKey) return null;
  return {
    async trigger(webhookPath, payload) {
      // Zapier webhook paths look like: /hooks/catch/12345678/abcdef/
      // The key doubles as a bearer token; Zapier accepts it either in
      // the URL (…?api_key=…) or as an Authorization header. Prefer
      // the header so URLs stay uncluttered in logs.
      const path = webhookPath.startsWith('/') ? webhookPath : `/${webhookPath}`;
      const url = `https://hooks.zapier.com${path}`;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          return { error: `zapier ${res.status}: ${(await res.text()).slice(0, 120)}` };
        }
        const body = (await res.json().catch(() => ({}))) as {
          id?: string;
          request_id?: string;
          status_url?: string;
        };
        return {
          ok: true,
          ...(body.id || body.request_id ? { runId: body.id ?? body.request_id } : {}),
          ...(body.status_url ? { statusUrl: body.status_url } : {}),
        };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
