import { ChevronRight, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';

const TRUST_DESTINATIONS = {
  plan: {
    href: '/plan',
    label: '套餐规则',
    description: '价格、周期和额度',
  },
  billing: {
    href: '/billing',
    label: '账单与付款',
    description: '有效期、记录和发票',
  },
  profile: {
    href: '/profile',
    label: '账号安全',
    description: '密码和双重验证',
  },
  terms: {
    href: '/terms',
    label: '服务条款',
    description: '续费、退款和使用规则',
  },
  privacy: {
    href: '/privacy',
    label: '隐私政策',
    description: '数据处理与账号权利',
  },
} as const;

export type TrustDestinationId = keyof typeof TRUST_DESTINATIONS;

export function TrustNavigation({
  destinations,
}: {
  readonly destinations: readonly TrustDestinationId[];
}): JSX.Element {
  return (
    <section className="rounded-[8px] border border-[#DCDDDD] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border border-[#EA1F59]/20 bg-[#FFF7F9] text-[#EA1F59]">
          <ShieldCheck className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">购买与账号保障</h2>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
            规则、付款记录和账号保护均可随时查看
          </p>
        </div>
      </div>
      <nav aria-label="购买与账号保障" className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {destinations.map((id) => {
          const destination = TRUST_DESTINATIONS[id];
          return (
            <Link
              key={id}
              to={destination.href}
              className="group flex min-h-14 items-center justify-between gap-3 rounded-[8px] border border-[#E7E7E7] bg-[#FAFAFA]/70 px-3 py-2.5 transition-colors hover:border-[#EA1F59]/25 hover:bg-[#FFF7F9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/25"
            >
              <span className="min-w-0">
                <span className="block text-xs font-medium text-[#3F3A3C]">
                  {destination.label}
                </span>
                <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                  {destination.description}
                </span>
              </span>
              <ChevronRight
                className="h-3.5 w-3.5 shrink-0 text-[#999999] transition-transform group-hover:translate-x-0.5 group-hover:text-[#EA1F59] motion-reduce:transition-none"
                aria-hidden
              />
            </Link>
          );
        })}
      </nav>
    </section>
  );
}
