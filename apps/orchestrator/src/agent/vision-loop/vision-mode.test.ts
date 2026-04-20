import { describe, expect, it } from 'vitest';
import {
  FAILURES_BEFORE_SWITCH,
  MIN_A11Y_ELEMENTS,
  readVisionModeEnv,
  selectVisionMode,
} from './vision-mode.js';

/**
 * Unit tests for the mode selector. Pure function — no setup needed.
 */

describe('selectVisionMode', () => {
  it('env=screenshot forces screenshot regardless of context', () => {
    const d = selectVisionMode({
      envMode: 'screenshot',
      intent: 'what is the email address shown',
      consecutiveFailures: 0,
    });
    expect(d.mode).toBe('screenshot');
    expect(d.reason).toMatch(/VISION_MODE=screenshot/);
  });

  it('env=accessibility forces accessibility regardless of context', () => {
    const d = selectVisionMode({
      envMode: 'accessibility',
      intent: '给我看看页面截图',
      consecutiveFailures: 10,
    });
    expect(d.mode).toBe('accessibility');
    expect(d.reason).toMatch(/VISION_MODE=accessibility/);
  });

  it('auto + visual keyword in intent → screenshot', () => {
    const cases = [
      '帮我看看这个页面',
      '帮我截图',
      '这个按钮长什么样',
      'what colour is the header',
      'take a screenshot',
      '页面布局是什么样的',
    ];
    for (const intent of cases) {
      const d = selectVisionMode({ envMode: 'auto', intent, consecutiveFailures: 0 });
      expect(d.mode, `intent: ${intent}`).toBe('screenshot');
      expect(d.reason).toMatch(/visual/);
    }
  });

  it('auto + non-visual intent → accessibility by default', () => {
    const d = selectVisionMode({
      envMode: 'auto',
      intent: '填一下联系表单并提交',
      consecutiveFailures: 0,
    });
    expect(d.mode).toBe('accessibility');
    expect(d.reason).toMatch(/default/);
  });

  it('auto + thin a11y tree in previous tick → downgrade to screenshot', () => {
    const d = selectVisionMode({
      envMode: 'auto',
      intent: 'do the thing',
      consecutiveFailures: 0,
      lastAccessibilityRefCount: MIN_A11Y_ELEMENTS - 1,
      previousMode: 'accessibility',
    });
    expect(d.mode).toBe('screenshot');
    expect(d.reason).toMatch(/too thin/);
    expect(d.reason).toContain(String(MIN_A11Y_ELEMENTS - 1));
  });

  it("thin-tree rule does NOT fire if previous mode was screenshot (can't re-downgrade)", () => {
    const d = selectVisionMode({
      envMode: 'auto',
      intent: 'do the thing',
      consecutiveFailures: 0,
      lastAccessibilityRefCount: 1,
      previousMode: 'screenshot',
    });
    // thin-tree rule only applies coming out of accessibility;
    // default wins and we go back to accessibility.
    expect(d.mode).toBe('accessibility');
    expect(d.reason).toMatch(/default/);
  });

  it('consecutive failures → swap from previous mode', () => {
    const fromA11y = selectVisionMode({
      envMode: 'auto',
      intent: 'do the thing',
      consecutiveFailures: FAILURES_BEFORE_SWITCH,
      previousMode: 'accessibility',
    });
    expect(fromA11y.mode).toBe('screenshot');
    expect(fromA11y.reason).toMatch(/consecutive failures.*accessibility/);

    const fromScreenshot = selectVisionMode({
      envMode: 'auto',
      intent: 'do the thing',
      consecutiveFailures: FAILURES_BEFORE_SWITCH,
      previousMode: 'screenshot',
    });
    expect(fromScreenshot.mode).toBe('accessibility');
    expect(fromScreenshot.reason).toMatch(/consecutive failures.*screenshot/);
  });

  it('fewer failures than threshold → no swap', () => {
    const d = selectVisionMode({
      envMode: 'auto',
      intent: 'do the thing',
      consecutiveFailures: FAILURES_BEFORE_SWITCH - 1,
      previousMode: 'accessibility',
    });
    // below threshold → default rules apply → accessibility
    expect(d.mode).toBe('accessibility');
  });

  it('env override beats intent, thin tree, and failures', () => {
    const d = selectVisionMode({
      envMode: 'accessibility',
      intent: '给我看看页面截图长什么样',
      consecutiveFailures: 99,
      lastAccessibilityRefCount: 0,
      previousMode: 'accessibility',
    });
    expect(d.mode).toBe('accessibility');
    expect(d.reason).toMatch(/VISION_MODE=accessibility/);
  });

  it('intent keyword beats thin-tree downgrade (user explicitly wants visuals)', () => {
    const d = selectVisionMode({
      envMode: 'auto',
      intent: '截图这个仪表盘',
      consecutiveFailures: 0,
      lastAccessibilityRefCount: 0,
      previousMode: 'accessibility',
    });
    expect(d.mode).toBe('screenshot');
    expect(d.reason).toMatch(/visual/);
  });
});

describe('readVisionModeEnv', () => {
  it('returns the literal value for recognised settings', () => {
    expect(readVisionModeEnv({ VISION_MODE: 'screenshot' })).toBe('screenshot');
    expect(readVisionModeEnv({ VISION_MODE: 'accessibility' })).toBe('accessibility');
    expect(readVisionModeEnv({ VISION_MODE: 'auto' })).toBe('auto');
  });

  it('is case-insensitive + trims whitespace', () => {
    expect(readVisionModeEnv({ VISION_MODE: 'SCREENSHOT' })).toBe('screenshot');
    expect(readVisionModeEnv({ VISION_MODE: '  accessibility  ' })).toBe('accessibility');
  });

  it('unrecognised values fall back to auto', () => {
    expect(readVisionModeEnv({ VISION_MODE: '' })).toBe('auto');
    expect(readVisionModeEnv({})).toBe('auto');
    expect(readVisionModeEnv({ VISION_MODE: 'xyz' })).toBe('auto');
  });
});
