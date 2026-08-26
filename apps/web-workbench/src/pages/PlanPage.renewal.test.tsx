// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlanPage } from './PlanPage';

const { authMeQuery, cnOptionsQuery, optionsQuery, showToast } = vi.hoisted(() => ({
  authMeQuery: vi.fn(),
  cnOptionsQuery: vi.fn(),
  optionsQuery: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    auth: { me: { query: authMeQuery } },
    payment: {
      cnOptions: { query: cnOptionsQuery },
      options: { query: optionsQuery },
    },
  },
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ show: showToast }),
}));

beforeEach(() => {
  Object.defineProperty(navigator, 'language', { configurable: true, value: 'zh-CN' });
  authMeQuery.mockResolvedValue({ plan: 'free' });
  optionsQuery.mockResolvedValue({ paypal: false, paypalClientId: null, paypalEnv: null });
  cnOptionsQuery.mockResolvedValue({ enabled: false, wechat: false, alipay: false });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PlanPage renewal disclosure', () => {
  it('does not present a guessed current plan or first-month eligibility while account data loads', () => {
    authMeQuery.mockReturnValue(new Promise(() => {}));

    render(
      <MemoryRouter initialEntries={['/plan']}>
        <PlanPage />
      </MemoryRouter>,
    );

    expect(screen.queryByText('当前使用中')).toBeNull();
    expect(screen.queryByText(/符合新付费用户优惠条件/)).toBeNull();
    expect(screen.getAllByRole('button', { name: '正在确认当前套餐…' })).toHaveLength(3);
  });

  it('states before checkout that paid periods do not renew or charge automatically', async () => {
    render(
      <MemoryRouter initialEntries={['/plan']}>
        <PlanPage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText('每次付款仅购买所选周期，到期前手动续费，不会自动扣款。'),
    ).toBeTruthy();
  });

  it('connects purchase decisions to billing, account security, and legal explanations', async () => {
    render(
      <MemoryRouter initialEntries={['/plan']}>
        <PlanPage />
      </MemoryRouter>,
    );

    await screen.findByText('每次付款仅购买所选周期，到期前手动续费，不会自动扣款。');
    const trustNavigation = screen.getByRole('navigation', { name: '购买与账号保障' });
    expect(trustNavigation.querySelector('a[href="/billing"]')).toBeTruthy();
    expect(trustNavigation.querySelector('a[href="/profile"]')).toBeTruthy();
    expect(trustNavigation.querySelector('a[href="/terms"]')).toBeTruthy();
    expect(trustNavigation.querySelector('a[href="/privacy"]')).toBeTruthy();
  });
});
