import { describe, expect, it, vi } from 'vitest';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { resolveMediaModelServices, videoModelServicesReady } from './media-model-services.js';

function runtime() {
  const messages = vi.fn(
    (purpose: string): MessagesAdapter => ({
      metadata: { provider: 'openai', model: purpose },
      create: vi.fn(),
    }),
  );
  return { kind: 'ready' as const, messages };
}

describe('resolveMediaModelServices', () => {
  it('uses the generate lane (standard) for scripts and the verifier lane (vision) for QA', () => {
    const generate = runtime();
    const verifier = runtime();
    const services = resolveMediaModelServices({ generate, verifier });
    expect(generate.messages).toHaveBeenCalledWith('standard');
    expect(verifier.messages).toHaveBeenCalledWith('vision');
    expect(services.scriptLlm).toBeTypeOf('function');
    expect(services.analyzeVideoQuality).toBeTypeOf('function');
    expect(services.verifySubject).toBeTypeOf('function');
    expect(videoModelServicesReady(services)).toBe(true);
  });

  it('reports video as not ready when either Qwen runtime is unavailable', () => {
    const noVerifier = resolveMediaModelServices({
      generate: runtime(),
      verifier: { kind: 'unavailable' },
    });
    expect(noVerifier.verifySubject).toBeNull();
    expect(videoModelServicesReady(noVerifier)).toBe(false);
    const noGenerate = resolveMediaModelServices({
      generate: { kind: 'unavailable' },
      verifier: runtime(),
    });
    expect(noGenerate.scriptLlm).toBeNull();
    expect(videoModelServicesReady(noGenerate)).toBe(false);
  });
});
