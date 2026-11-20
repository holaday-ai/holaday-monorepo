import { describe, expect, it } from 'vitest';
import { assessCompletionFacts } from './completion-fields.js';

// FIX-62 P1-6 (DEPLOY-61 第三次 单列 2): five correct books, each line 「name — price，stock」, were all
// labelled 未核实 — the whole line was looked for verbatim.
describe('FIX-62 P1-6: name — price, more on a listed line', () => {
  const book = (name: string, price: string, n: number) =>
    [
      `- heading "${name}" [level=1]`,
      `- paragraph: ${price}`,
      `- paragraph: In stock (${n} available)`,
    ].join('\n');
  const pages = [
    { text: book('A Light in the Attic', '£51.77', 22) },
    { text: book('Tipping the Velvet', '£53.74', 20) },
  ];
  it('each part found on the page: nothing unverified, nothing contradicted', () => {
    const facts = assessCompletionFacts({
      summary:
        '已依次打开前 2 本书的详情页并读取信息如下：\n\n1. A Light in the Attic — £51.77，In stock (22 available)\n2. Tipping the Velvet — £53.74，In stock (20 available)',
      pages,
      intent: '打开 books.toscrape.com，进入前 2 本书的详情页，告诉我每本书的书名、价格和库存',
    });
    expect(facts.unverified).toEqual([]);
    expect(facts.contradictions).toEqual([]);
  });
  it('a stock the page does not show is still not taken as read', () => {
    const facts = assessCompletionFacts({
      summary: '1. A Light in the Attic — £51.77，In stock (99 available)',
      pages,
      intent: '书名、价格和库存',
    });
    expect([...facts.unverified, ...facts.contradictions].join('\n')).toMatch(/99 available/);
  });
});
