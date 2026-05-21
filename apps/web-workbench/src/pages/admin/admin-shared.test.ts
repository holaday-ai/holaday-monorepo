import { describe, expect, it } from 'vitest';
import { statusToken } from './admin-shared';

describe('admin statusToken', () => {
  it('renders partial success as a user-facing warning label', () => {
    const token = statusToken('partial_success');

    expect(token.label).toBe('部分完成');
    expect(token.textClass).toContain('amber');
  });
});
