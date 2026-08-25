import { PageContainer, PageHeader, Section } from '@/pages/PageShell';
import { Link } from 'react-router-dom';

type PrivacySectionId =
  | 'data'
  | 'extension'
  | 'providers'
  | 'retention'
  | 'rights'
  | 'security'
  | 'minors'
  | 'updates'
  | 'contact';

interface PrivacyNavItem {
  id: PrivacySectionId;
  label: string;
}

interface DataCategory {
  label: string;
  data: string;
  purpose: string;
  processors: string;
  retention: string;
}

const NAV_ITEMS: PrivacyNavItem[] = [
  { id: 'data', label: '我们处理什么' },
  { id: 'extension', label: '浏览器扩展' },
  { id: 'providers', label: '第三方与跨境' },
  { id: 'retention', label: '保存与删除' },
  { id: 'rights', label: '您的权利' },
  { id: 'security', label: '安全措施' },
  { id: 'minors', label: '未成年人' },
  { id: 'updates', label: '政策更新' },
  { id: 'contact', label: '联系我们' },
];

const DATA_CATEGORIES: DataCategory[] = [
  {
    label: '账号与安全',
    data: '邮箱、手机号、昵称、头像、密码哈希、MFA 与登录会话',
    purpose: '注册、登录、身份确认与账号安全',
    processors: 'HOLA DAY；按登录方式可能涉及 Google、邮件或短信服务',
    retention: '账号存续及安全所需；可通过邮件申请处理',
  },
  {
    label: '任务与执行',
    data: '指令、计划、步骤、结果、错误、截图、网页上下文与文件',
    purpose: '执行、恢复和验证您提交的任务',
    processors: 'HOLA DAY；按所选能力可能涉及 AI、抓取或媒体服务',
    retention: '套餐天数只控制可见历史；实际按数据类别和申请处理',
  },
  {
    label: '扩展常用网站',
    data: '最近 30 天访问记录在设备端汇总后的域名、访问次数与最近访问时间',
    purpose: '优先准备常用站点配置',
    processors: 'HOLA DAY',
    retention: '下一次成功同步会替换旧快照；停止同步不等于自动删除',
  },
  {
    label: '扩展登录态',
    data: '您授权的白名单网站的真实 Cookie 值',
    purpose: '让 HOLA DAY 任务浏览器继承已授权登录状态',
    processors: 'HOLA DAY 浏览器执行环境',
    retention: '有可用浏览器时即时注入，否则暂存至下一次注入',
  },
  {
    label: '支付与套餐',
    data: '订单、金额、币种、购买内容、状态、渠道标识与可能的付款邮箱',
    purpose: '结算、发放权益、退款和处理争议',
    processors: 'PayPal 或中国支付服务，取决于您选择的渠道',
    retention: '按交易、税务、争议和适用法律所需保存',
  },
  {
    label: '媒体素材',
    data: '您上传的图片、视频、语音，以及声音克隆标识和授权时间',
    purpose: '完成您明确请求的图片、视频或语音任务',
    processors: 'Google、Alibaba Cloud、fal.ai 等，视所选功能而定',
    retention: '按文件可用期、账号处理及必要的安全或授权证据标准保存',
  },
  {
    label: '分析与日志',
    data: '固定事件聚合、匿名摘要、IP、User-Agent、操作与错误日志',
    purpose: '保障安全与稳定、排查故障并改进体验',
    processors: 'HOLA DAY 基础设施及必要的运维服务',
    retention: '按具体分析配置、故障、安全和法律所需的最短期限',
  },
];

const SUMMARY_ITEMS = [
  {
    number: '01',
    title: '完成任务所需',
    body: '我们处理账号、任务和执行数据，用于响应您的请求、交付结果并保护账号。',
  },
  {
    number: '02',
    title: '扩展数据分两类',
    body: '常用网站是域名级聚合；登录态同步则会处理您授权站点的真实 Cookie 值。',
  },
  {
    number: '03',
    title: '外部处理按功能发生',
    body: '部分任务会交给境内外的 AI、媒体、存储、通信或支付服务商处理。',
  },
  {
    number: '04',
    title: '邮件是申请入口',
    body: '您可申请查阅、更正或删除。邮件是申请入口，不代表即时或自动完成。',
  },
];

function DataCards(): JSX.Element {
  return (
    <div className="space-y-3 md:hidden">
      {DATA_CATEGORIES.map((category) => (
        <article
          key={category.label}
          className="rounded-[8px] border border-[#E8E8E8] bg-[#FAFAFA] p-4"
        >
          <h3 className="text-sm font-semibold text-foreground">{category.label}</h3>
          <dl className="mt-3 space-y-2.5 text-xs leading-relaxed">
            <div>
              <dt className="font-medium text-foreground">具体内容</dt>
              <dd className="mt-0.5 text-muted-foreground">{category.data}</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">用途</dt>
              <dd className="mt-0.5 text-muted-foreground">{category.purpose}</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">可能的处理方</dt>
              <dd className="mt-0.5 text-muted-foreground">{category.processors}</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">保存标准或控制</dt>
              <dd className="mt-0.5 text-muted-foreground">{category.retention}</dd>
            </div>
          </dl>
        </article>
      ))}
    </div>
  );
}

function DataTable(): JSX.Element {
  return (
    <div className="hidden overflow-hidden rounded-[8px] border border-[#E3E3E3] md:block">
      <table
        aria-label="HOLA DAY 个人信息处理说明"
        className="w-full table-fixed border-collapse text-left text-[11px] leading-relaxed"
      >
        <thead className="bg-[#F7F7F7] text-foreground">
          <tr>
            <th className="w-[14%] px-3 py-3 font-semibold">数据类别</th>
            <th className="w-[22%] px-3 py-3 font-semibold">具体内容</th>
            <th className="w-[18%] px-3 py-3 font-semibold">用途</th>
            <th className="w-[22%] px-3 py-3 font-semibold">可能的处理方</th>
            <th className="w-[24%] px-3 py-3 font-semibold">保存标准或控制</th>
          </tr>
        </thead>
        <tbody>
          {DATA_CATEGORIES.map((category) => (
            <tr key={category.label} className="border-t border-[#E8E8E8] align-top">
              <th className="px-3 py-3 font-semibold text-foreground">{category.label}</th>
              <td className="px-3 py-3 text-muted-foreground">{category.data}</td>
              <td className="px-3 py-3 text-muted-foreground">{category.purpose}</td>
              <td className="px-3 py-3 text-muted-foreground">{category.processors}</td>
              <td className="px-3 py-3 text-muted-foreground">{category.retention}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProviderGroup({
  title,
  providers,
  children,
}: {
  title: string;
  providers: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <article className="rounded-[8px] border border-[#E8E8E8] bg-[#FAFAFA] p-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-xs font-medium text-[#6D55A5]">{providers}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{children}</p>
    </article>
  );
}

export function PrivacyPage(): JSX.Element {
  return (
    <PageContainer width="form">
      <PageHeader
        title="隐私政策"
        description="最后更新：2026-08-25 · 本页说明 HOLA DAY 实际如何处理个人信息"
      />

      <main className="space-y-4 text-sm leading-relaxed text-foreground">
        <section
          aria-labelledby="summary-heading"
          className="rounded-[8px] border border-[#DED8EA] bg-gradient-to-br from-[#FBF9FF] via-white to-[#F7FBFF] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-6"
        >
          <div className="max-w-2xl">
            <p className="text-xs font-medium tracking-wide text-[#7655A6]">阅读约 6 分钟</p>
            <h2 id="summary-heading" className="mt-1 text-lg font-semibold tracking-tight">
              先看重点
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              HOLA DAY 只应为明确目的处理必要信息。不同功能处理的数据和外部服务并不相同。
            </p>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {SUMMARY_ITEMS.map((item) => (
              <article
                key={item.number}
                className="flex gap-3 rounded-[8px] border border-white/80 bg-white/80 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.025)]"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#F1EAFE] text-[10px] font-semibold text-[#6F52A3]">
                  {item.number}
                </span>
                <div>
                  <h3 className="text-sm font-semibold">{item.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.body}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <nav
          aria-label="隐私政策目录"
          className="rounded-[8px] border border-[#E3E3E3] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
        >
          <p className="mb-2 text-[11px] font-medium text-muted-foreground">快速查看</p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="text-xs font-medium text-foreground underline decoration-[#CFC4E3] decoration-1 underline-offset-4 transition-colors hover:text-[#6F52A3]"
              >
                {item.label}
              </a>
            ))}
          </div>
        </nav>

        <Section
          id="data"
          title="我们处理什么"
          description="具体范围取决于您实际使用的功能。下表中的“可能”不代表每次任务都会使用该处理方。"
        >
          <DataCards />
          <DataTable />
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            我们也会使用 Cookie 和 localStorage 维持 HOLA DAY
            登录状态和保存界面偏好。禁用后，部分功能可能无法正常使用。
          </p>
        </Section>

        <Section
          id="extension"
          title="浏览器扩展：两类数据，两种边界"
          description="常用网站统计和登录态同步不是同一种处理。"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <article className="rounded-[8px] border border-[#DCE8E5] bg-[#F6FBFA] p-4">
              <p className="text-[11px] font-medium text-[#377F70]">常用网站统计</p>
              <h3 className="mt-1 text-sm font-semibold">只上传域名级聚合</h3>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                扩展在您的设备上汇总最近 30 天记录，只发送域名、访问次数和最近访问时间； 不上传完整
                URL、查询参数、网页标题或历史页面正文。下一次成功同步会替换服务器上的旧快照。
              </p>
            </article>
            <article className="rounded-[8px] border border-[#E6DDF3] bg-[#FBF8FF] p-4">
              <p className="text-[11px] font-medium text-[#7655A6]">登录态同步</p>
              <h3 className="mt-1 text-sm font-semibold">会处理真实 Cookie 值</h3>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                仅接收服务端白名单内、由您授权的网站 Cookie，用于让您发起的 HOLA DAY
                浏览器任务继承登录状态。 我们不将其出售、用于广告画像或共享给其他用户。
              </p>
            </article>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            停用或卸载扩展可以阻止未来读取，但不会自动删除服务器已经收到的数据；您可以通过下方渠道申请处理。
          </p>
        </Section>

        <Section
          id="providers"
          title="第三方服务与跨境处理"
          description="以下服务是否参与，取决于您使用的功能和当时启用的服务。"
        >
          <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
            为完成您选择的任务，必要的指令、文件、媒体素材、账号或交易信息可能由相关服务商处理，
            也可能在中国大陆以外处理。我们不会把下列服务写成每次任务都会使用；启用需要单独同意的处理时，
            我们会按适用法律取得相应同意。
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <ProviderGroup title="基础设施与存储" providers="Vultr · Cloudflare R2 · Aliyun">
              用于计算、数据库、静态内容分发、文件存储和必要的网络服务。
            </ProviderGroup>
            <ProviderGroup
              title="AI、抓取与媒体"
              providers="Anthropic · Google · OpenAI · Alibaba Cloud DashScope · fal.ai · Firecrawl · DivineAPI"
            >
              按功能处理任务指令、网页内容、图片、视频、语音、星座或塔罗请求及生成结果。
            </ProviderGroup>
            <ProviderGroup
              title="身份、通信与支付"
              providers="Google · Resend · 短信网关 · PayPal · 中国支付服务"
            >
              用于第三方登录、验证码、服务邮件、收款、权益发放、退款与争议处理。
            </ProviderGroup>
          </div>
          <div className="mt-4 rounded-[8px] bg-[#F7F7F7] px-4 py-3 text-xs leading-relaxed text-muted-foreground">
            支付记录可能包含支付渠道标识和付款邮箱。HOLA DAY 不直接保存银行卡号、CVV
            或第三方支付账户密码。 每次付款只购买所选周期，到期前由您手动续费，不会自动扣款。
          </div>
        </Section>

        <Section
          id="retention"
          title="保存与删除"
          description="能给出期限时说明期限；无法统一时说明决定标准。"
        >
          <div className="space-y-3 text-xs text-muted-foreground">
            <p>
              <strong className="font-semibold text-foreground">任务历史：</strong>
              套餐中的 7/30/90
              天表示默认可见范围，不是服务器删除期限。任务、截图、文件和验证材料会按其类别、
              文件界面显示的到期时间、服务需要和删除申请分别处理。
            </p>
            <p>
              <strong className="font-semibold text-foreground">扩展数据：</strong>
              常用网站快照由下次成功同步替换；登录 Cookie
              在有可用浏览器时即时注入，或暂存至下一次注入。 当前不承诺尚未实现的统一自动清理期限。
            </p>
            <p>
              <strong className="font-semibold text-foreground">支付与运维记录：</strong>
              交易、安全、争议或审计记录会按履行交易、法定义务、保障安全和解决争议所需保存，条件结束后删除或去标识化。
              其他日志按故障排查、安全和运营所必需的最短期限处理，并非统一固定天数。
            </p>
          </div>
        </Section>

        <Section
          id="rights"
          title="您的权利"
          description="适用法律可能赋予您查阅、复制、更正、删除、撤回同意、限制或反对处理以及投诉的权利。"
        >
          <p className="text-xs leading-relaxed text-muted-foreground">
            当前请发送邮件至{' '}
            <a
              className="font-medium text-[#6F52A3] underline underline-offset-4"
              href="mailto:privacy@holaday.ai"
            >
              privacy@holaday.ai
            </a>{' '}
            提交申请。邮件是申请入口，不代表即时或自动完成。为保护账号，我们会先确认账号归属，再处理账号关闭和可处理的关联数据。
            依法需要保留，或处理交易、安全、争议所必需的记录，可能在相应条件结束前继续受限保存。
          </p>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            请勿在初次邮件中发送密码、验证码、身份证件照片或完整支付信息。若请求受到适用法律限制，我们会说明可以处理的范围。
          </p>
        </Section>

        <Section id="security" title="安全措施">
          <p className="text-xs leading-relaxed text-muted-foreground">
            HOLA DAY 使用访问控制、传输保护、敏感请求头遮蔽和运行监控等措施降低风险。账号密码使用
            Argon2id 不可逆单向哈希保存；MFA
            密钥使用加密封装。没有任何互联网传输或存储方式能够保证绝对安全，
            我们会根据风险持续改进措施并处理安全事件。
          </p>
        </Section>

        <Section id="minors" title="未成年人">
          <p className="text-xs leading-relaxed text-muted-foreground">
            本服务不面向 14
            周岁以下未成年人。若您认为未成年人未经监护人同意向我们提供了个人信息，请通过隐私邮箱联系；
            我们会核实并按适用法律处理。
          </p>
        </Section>

        <Section id="updates" title="政策更新">
          <p className="text-xs leading-relaxed text-muted-foreground">
            政策更新会在本页标明新日期。重大变化会通过合理渠道提示；适用法律要求重新同意或单独同意的处理，
            会在取得相应同意后启用，不以继续使用代替所需同意。
          </p>
        </Section>

        <Section id="contact" title="联系我们">
          <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
            <p>
              隐私与个人信息申请：{' '}
              <a
                className="font-medium text-[#6F52A3] underline underline-offset-4"
                href="mailto:privacy@holaday.ai"
              >
                privacy@holaday.ai
              </a>
            </p>
            <p>
              一般支持：{' '}
              <a
                className="font-medium text-[#6F52A3] underline underline-offset-4"
                href="mailto:support@holaday.ai"
              >
                support@holaday.ai
              </a>
            </p>
            <p>
              同时请查阅{' '}
              <Link className="font-medium text-[#6F52A3] underline underline-offset-4" to="/terms">
                服务条款
              </Link>
              。
            </p>
          </div>
        </Section>
      </main>
    </PageContainer>
  );
}
