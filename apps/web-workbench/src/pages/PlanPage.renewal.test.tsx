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
});
