import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PageContainer } from './PageShell';

describe('PageContainer', () => {
  it('reserves mobile header space below the fixed navigation controls', () => {
    const markup = renderToStaticMarkup(
      <PageContainer>
        <h1>页面标题</h1>
      </PageContainer>,
    );

    expect(markup).toContain('pt-14');
  });

  it('reserves desktop header space below the fixed account dock', () => {
    const markup = renderToStaticMarkup(
      <PageContainer>
        <button type="button">页面操作</button>
      </PageContainer>,
    );

    expect(markup).toContain('min-[769px]:pt-20');
  });
});
