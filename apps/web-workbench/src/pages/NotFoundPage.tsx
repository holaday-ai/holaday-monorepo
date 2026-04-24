import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export function NotFoundPage(): JSX.Element {
  return (
    <div className="flex min-h-full items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 inline-flex h-14 w-14 items-center justify-center rounded-full bg-muted text-2xl font-semibold text-muted-foreground">
          404
        </div>
        <h1 className="text-xl font-semibold tracking-tight">页面不存在</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          你访问的页面可能已被移动或删除。回到工作台继续使用 HOLA DAY。
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Link to="/">
            <Button>返回首页</Button>
          </Link>
          <Button variant="outline" onClick={() => window.history.back()}>
            返回上一页
          </Button>
        </div>
      </div>
    </div>
  );
}
