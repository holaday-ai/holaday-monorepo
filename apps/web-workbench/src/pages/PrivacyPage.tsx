import { Link } from 'react-router-dom';
import { PageContainer, PageHeader } from '@/pages/PageShell';

/**
 * Privacy policy. Template text covering GDPR + PIPL basics. Must be
 * reviewed by counsel before the product takes paying users — the
 * placeholders around data retention and international transfers are
 * the weakest parts.
 */
export function PrivacyPage(): JSX.Element {
  return (
    <PageContainer width="prose">
      <PageHeader title="隐私政策" description="最后更新：2026-04-24" />
      <article className="prose prose-sm max-w-none dark:prose-invert prose-headings:tracking-tight">
        <p>
          HOLA DAY（下称"我们"）非常重视您的隐私。本隐私政策说明我们如何收集、使用、
          存储和保护您在使用 holaday.ai 网站及相关服务（下称"服务"）过程中提供的个人信息。
          本政策适用于所有使用本服务的用户，并已根据《中华人民共和国个人信息保护法》
          及欧盟《通用数据保护条例》（GDPR）等法律法规编制。
        </p>

        <h2>1. 我们收集的信息</h2>
        <p>我们仅在为您提供服务所必需的范围内收集以下信息：</p>
        <ul>
          <li>
            <strong>账号信息</strong>：邮箱地址、密码（加密存储）、昵称、头像、手机号（可选）。
          </li>
          <li>
            <strong>任务数据</strong>：您提交的任务指令、执行过程截图、结果文本。
          </li>
          <li>
            <strong>使用日志</strong>：IP 地址、User-Agent、访问时间、操作路径等技术日志。
          </li>
          <li>
            <strong>支付信息</strong>：订单金额和订阅状态；实际卡号或账户由第三方支付服务商处理，
            我们不存储敏感支付数据。
          </li>
        </ul>

        <h2>2. 我们如何使用信息</h2>
        <ul>
          <li>为您执行提交的任务并反馈结果；</li>
          <li>维护账号安全、防止滥用和欺诈；</li>
          <li>改进产品体验、定位故障；</li>
          <li>在您授权的情况下，向您发送产品更新或服务通知。</li>
        </ul>

        <h2>3. 信息共享</h2>
        <p>
          除以下情形外，我们不会向第三方出售、出租或披露您的个人信息：
        </p>
        <ul>
          <li>获得您的事先同意；</li>
          <li>为履行法律义务、配合司法机关合法调查；</li>
          <li>委托技术服务商（如云主机、对象存储、支付网关）处理必要数据，并通过合同约束其保密义务。</li>
        </ul>

        <h2>4. 跨境数据传输</h2>
        <p>
          我们的服务器主要位于中国大陆。当您使用 Claude、Google 等第三方模型或集成时，
          相关指令和截图可能会传输到境外服务商。我们会与第三方签订数据处理协议，
          并仅在完成您所请求的任务时传输最小必要数据。
        </p>

        <h2>5. 数据保留</h2>
        <ul>
          <li>账号信息在您主动注销前持续保留；</li>
          <li>任务记录按套餐约定保留（Free 7 天 / Basic 30 天 / Pro 永久）；</li>
          <li>日志默认保留 90 天，之后自动脱敏或删除。</li>
        </ul>

        <h2>6. 您的权利</h2>
        <p>您对您的个人信息享有以下权利，可在设置页或通过邮件联系我们行使：</p>
        <ul>
          <li>查阅、复制您的个人信息；</li>
          <li>更正错误或不完整的信息；</li>
          <li>删除账号及相关数据；</li>
          <li>撤回同意、限制或反对处理；</li>
          <li>投诉至相关监管机构。</li>
        </ul>

        <h2>7. 未成年人</h2>
        <p>
          本服务不面向 14 周岁以下未成年人。若您发现未成年人未经监护人同意使用本服务，
          请联系我们，我们将及时删除相关信息。
        </p>

        <h2>8. Cookies 与类似技术</h2>
        <p>
          我们使用 Cookie 和 localStorage 维持登录状态和保存界面偏好。您可以在浏览器中
          禁用这些技术，但部分功能将无法使用。
        </p>

        <h2>9. 政策更新</h2>
        <p>
          本政策可能适时更新。重大变更会通过站内通知或邮件告知。持续使用本服务即视为
          接受更新后的政策。
        </p>

        <h2>10. 联系我们</h2>
        <p>
          如您对本政策有任何疑问，可通过邮件发送至{' '}
          <a href="mailto:privacy@holaday.ai">privacy@holaday.ai</a>。同时欢迎查阅我们的
          <Link to="/terms">服务条款</Link>。
        </p>
      </article>
    </PageContainer>
  );
}
