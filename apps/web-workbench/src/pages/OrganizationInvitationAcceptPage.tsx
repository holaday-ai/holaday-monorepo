import { useAppShellContext } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc';
import { PageContainer, PageHeader } from '@/pages/PageShell';
import { CheckCircle2, Loader2, ShieldCheck, TriangleAlert } from 'lucide-react';
import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

type AcceptanceState =
  | { readonly status: 'invalid' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'pending' }
  | { readonly status: 'accepted'; readonly alreadyMember: boolean }
  | { readonly status: 'failed' };

export function invitationTokenFromHash(hash: string): string {
  if (!hash.startsWith('#')) return '';
  return new URLSearchParams(hash.slice(1)).get('token')?.trim() ?? '';
}

export function invitationSafePath(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete('token');
  const safeSearch = params.toString();
  return `${pathname}${safeSearch ? `?${safeSearch}` : ''}`;
}

/**
 * Invitation secrets use the URL fragment so they never reach nginx. The
 * route captures the value once, clears the visible URL immediately, and
 * submits at most one acceptance mutation for this mounted page.
 */
export function OrganizationInvitationAcceptPage(): JSX.Element {
  const { me } = useAppShellContext();
  const location = useLocation();
  const navigate = useNavigate();
  const tokenRef = React.useRef(invitationTokenFromHash(location.hash));
  const submittedRef = React.useRef(false);
  const authCheckStartedRef = React.useRef(false);
  const [state, setState] = React.useState<AcceptanceState>(() =>
    tokenRef.current ? { status: 'pending' } : { status: 'invalid' },
  );

  React.useLayoutEffect(() => {
    const hasLegacyQueryToken = new URLSearchParams(location.search).has('token');
    if (!location.hash && !hasLegacyQueryToken) return;
    window.history.replaceState(
      window.history.state,
      '',
      invitationSafePath(location.pathname, location.search),
    );
  }, [location.hash, location.pathname, location.search]);

  React.useEffect(() => {
    const submit = (token: string) => {
      if (submittedRef.current || tokenRef.current !== token) return;
      submittedRef.current = true;
      tokenRef.current = '';
      void trpc.organizations.acceptInvitation.mutate({ token }).then(
        (result) => {
          setState({ status: 'accepted', alreadyMember: result.status === 'already_member' });
        },
        () => {
          setState({ status: 'failed' });
        },
      );
    };
    const markUnavailable = () => {
      tokenRef.current = '';
      setState({ status: 'unavailable' });
    };
    const token = tokenRef.current;
    if (!token || submittedRef.current) return;
    if (me) {
      if (me.teamProjectsEnabled === true) submit(token);
      else markUnavailable();
      return;
    }
    if (authCheckStartedRef.current) return;
    authCheckStartedRef.current = true;
    void trpc.auth.me.query().then(
      (snapshot) => {
        const pendingToken = tokenRef.current;
        if (!pendingToken || submittedRef.current) return;
        if (snapshot.teamProjectsEnabled === true) submit(pendingToken);
        else markUnavailable();
      },
      () => {
        tokenRef.current = '';
        setState({ status: 'failed' });
      },
    );
  }, [me]);

  return (
    <PageContainer width="form">
      <PageHeader title="加入团队空间" description="安全验证这次团队邀请" />
      <InvitationResult state={state} onProjects={() => navigate('/projects')} />
    </PageContainer>
  );
}

function InvitationResult({
  state,
  onProjects,
}: {
  readonly state: AcceptanceState;
  readonly onProjects: () => void;
}): JSX.Element {
  const content = invitationResultContent(state);
  const Icon = content.icon;
  return (
    <section
      aria-live="polite"
      className="rounded-[12px] border border-[#E4E4E7] bg-white p-6 shadow-[0_8px_28px_rgba(24,24,27,0.06)] sm:p-8"
    >
      <div className="flex items-start gap-4">
        <div className="rounded-full bg-[#FFF0F4] p-3 text-[#EA1F59]">
          <Icon className={state.status === 'pending' ? 'h-6 w-6 animate-spin' : 'h-6 w-6'} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-foreground">{content.title}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{content.description}</p>
          {state.status !== 'pending' ? (
            <Button type="button" className="mt-5 min-h-11" onClick={onProjects}>
              前往项目空间
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function invitationResultContent(state: AcceptanceState): {
  readonly title: string;
  readonly description: string;
  readonly icon: typeof ShieldCheck;
} {
  if (state.status === 'pending') {
    return {
      title: '正在验证邀请',
      description: '请稍候，Holaday 正在确认邀请仍然有效且尚未被使用。',
      icon: Loader2,
    };
  }
  if (state.status === 'accepted') {
    return {
      title: state.alreadyMember ? '你已经在这个团队中' : '已加入团队',
      description: '邀请已完成，团队项目会出现在你的项目空间中。',
      icon: CheckCircle2,
    };
  }
  if (state.status === 'unavailable') {
    return {
      title: '团队空间暂未开放',
      description: '当前账号或团队未开放此功能，请联系邀请人确认。',
      icon: ShieldCheck,
    };
  }
  return {
    title: state.status === 'invalid' ? '邀请链接不完整' : '邀请已失效',
    description:
      state.status === 'invalid'
        ? '链接中没有可用的邀请凭据，请让邀请人重新生成。'
        : '邀请可能已过期、撤回或使用过，请让邀请人重新生成。',
    icon: TriangleAlert,
  };
}
