// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { TermsPage } from './TermsPage';

afterEach(cleanup);

describe('TermsPage billing policy', () => {
  it('describes the implemented prepaid manual-renewal model without promising recurring charges', () => {
    render(
      <MemoryRouter>
        <TermsPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByText('每次付款仅购买所选周期，到期前手动续费，不会自动扣款。'),
    ).toBeTruthy();
    expect(screen.queryByText(/按月自动续费/)).toBeNull();
    expect(screen.getByRole('heading', { name: '4. 付费与套餐' })).toBeTruthy();
  });
});
