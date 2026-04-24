import { Link } from 'react-router-dom';
import { PageShell } from '@/pages/PageShell';

/**
 * Terms of service. Template text; must be reviewed by counsel before
 * paid-tier launch. Covers acceptable use, payment, termination,
 * liability caps, and dispute resolution.
 */
export function TermsPage(): JSX.Element {
  return (
    <PageShell title="服务条款" subtitle="最后更新：2026-04-24" width="3xl">
      <article className="prose prose-sm max-w-none dark:prose-invert prose-headings:tracking-tight">
        <p>
          欢迎使用 HOLA DAY（下称"我们"、"本服务"）。本服务条款（下称"本条款"）构成您
          与我们之间具有法律约束力的协议。请您在使用本服务前仔细阅读并同意本条款。
        </p>

        <h2>1. 服务内容</h2>
        <p>
          HOLA DAY 提供 AI 驱动的浏览器自动化服务，帮助用户通过自然语言指令完成网页操作
          任务。我们有权根据业务需要对服务内容、功能及可用性进行调整。
        </p>

        <h2>2. 账号注册</h2>
        <ul>
          <li>您需提供真实、有效的邮箱完成注册，并妥善保管账号和密码；</li>
          <li>一个用户原则上只注册一个账号，禁止将账号转让或出借给他人；</li>
          <li>若发现账号存在安全风险，请立即联系我们。</li>
        </ul>

        <h2>3. 可接受使用</h2>
        <p>使用本服务时，您承诺不进行以下行为：</p>
        <ul>
          <li>违反国家法律法规或公序良俗；</li>
          <li>爬取、刷单、垃圾信息群发、恶意点击等干扰第三方平台的行为；</li>
          <li>规避目标网站的反爬机制或访问被明确禁止的内容；</li>
          <li>发布涉及侵权、欺诈、色情、暴力、恐怖等违法内容；</li>
          <li>逆向工程、破解、未经授权访问本服务的源代码或数据。</li>
        </ul>
        <p>
          一旦发现违规行为，我们有权限制或终止您对本服务的使用，并保留追究法律责任的权利。
        </p>

        <h2>4. 付费与订阅</h2>
        <ul>
          <li>付费套餐的内容、价格及续费规则详见{' '}<Link to="/plan">套餐页面</Link>；</li>
          <li>订阅按月自动续费，您可随时在{' '}<Link to="/billing">账单页面</Link>取消；</li>
          <li>除法律强制要求外，已支付的订阅费用不予退还；</li>
          <li>我们有权基于业务调整定价，变更前会至少提前 7 天通过站内或邮件通知。</li>
        </ul>

        <h2>5. 知识产权</h2>
        <p>
          本服务所涉及的商标、Logo、界面设计、代码、文档等知识产权均归 HOLA DAY 所有或
          经合法授权使用。您提交的任务指令和自定义内容的知识产权归您所有，您授予我们
          在提供服务所必要范围内使用的许可。
        </p>

        <h2>6. 免责声明</h2>
        <ul>
          <li>本服务按"现状"提供，我们不对任务执行结果的完整性、准确性、时效性作出保证；</li>
          <li>对因第三方网站的变更、宕机、反爬策略导致的任务失败，我们不承担责任；</li>
          <li>在法律允许的最大范围内，我们对间接、偶然、特殊、惩罚性损害不承担赔偿责任。</li>
        </ul>

        <h2>7. 赔偿责任上限</h2>
        <p>
          除非适用法律另有规定，我们在任何情况下对您的累计赔偿责任不超过您在主张产生的
          前 12 个月内实际支付给本服务的费用。
        </p>

        <h2>8. 服务终止</h2>
        <p>
          您可以随时在账号设置中注销账号。我们有权在以下情况下终止本服务或您的账号：
          违反本条款、长期不活跃、业务调整等。我们会在合理期限内提前通知您并协助导出数据。
        </p>

        <h2>9. 争议解决</h2>
        <p>
          本条款适用中华人民共和国法律。因本条款产生的争议，双方应友好协商解决；协商不成的，
          任何一方均可向 HOLA DAY 运营主体所在地有管辖权的人民法院提起诉讼。
        </p>

        <h2>10. 其他</h2>
        <ul>
          <li>本条款的任何条款被认定无效或不可执行的，不影响其他条款的效力；</li>
          <li>我们可能适时修订本条款，修订后的条款自发布之日起生效；</li>
          <li>请同时参阅我们的<Link to="/privacy">隐私政策</Link>。</li>
        </ul>

        <p>
          如有疑问，请联系 <a href="mailto:support@holaday.ai">support@holaday.ai</a>。
        </p>
      </article>
    </PageShell>
  );
}
