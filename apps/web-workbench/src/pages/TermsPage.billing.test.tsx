// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { TermsPage } from './TermsPage';

afterEach(cleanup);

describe('TermsPage billing policy', () => {
  it('identifies the contracting operator and contact address', () => {
    render(
      <MemoryRouter>
        <TermsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText(/最后更新：2026-08-26/)).toBeTruthy();
    expect(screen.getByText(/合同相对方及运营主体：上海慕雾品牌管理有限公司/)).toBeTruthy();
    expect(screen.getByText(/联系地址：上海市虹口区汶水东路351号B幢306室/)).toBeTruthy();
  });

  it('describes the implemented prepaid manual-renewal model without promising recurring charges', () => {
    render(
      <MemoryRouter>
        <TermsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('每次付款仅购买所选周期，到期前手动续费，不会自动扣款。')).toBeTruthy();
    expect(screen.queryByText(/按月自动续费/)).toBeNull();
    expect(screen.getByRole('heading', { name: '4. 付费与套餐' })).toBeTruthy();
  });
});
