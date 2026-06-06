import { AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export function ServerErrorPage(): JSX.Element {
  return (
    <div className="flex min-h-full items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 inline-flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10 text-red-500">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">服务暂时不可用</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          服务刚才没有正常响应。我们已经记录了这次异常，通常刷新后就能恢复。
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button onClick={() => window.location.reload()}>重试</Button>
          <Link to="/">
            <Button variant="outline">返回首页</Button>
          </Link>
        </div>
        <p className="mt-6 text-[11px] text-muted-foreground">
          问题持续？请联系{' '}
          <a href="mailto:support@holaday.ai" className="underline hover:text-foreground">
            support@holaday.ai
          </a>
        </p>
      </div>
    </div>
  );
}
