import { Camera, Loader2 } from 'lucide-react';
import * as React from 'react';
import { PageShell, Row, Section } from '@/pages/PageShell';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { trpc } from '@/lib/trpc';

/**
 * User profile page. Loads auth.me to seed the form. Only client-side
 * state for now — backend mutations (updateProfile / changePassword)
 * aren't built yet, so submit currently shows a "saved locally" toast
 * and the new values live in React state.
 */
export function ProfilePage(): JSX.Element {
  const toast = useToast();
  const [loading, setLoading] = React.useState(true);
  const [email, setEmail] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [avatar, setAvatar] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [passwordOpen, setPasswordOpen] = React.useState(false);
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');

  React.useEffect(() => {
    let active = true;
    trpc.auth.me.query().then(
      (res) => {
        if (!active) return;
        setEmail(res.email ?? '');
        setDisplayName(res.displayName ?? '');
        setLoading(false);
      },
      () => {
        if (!active) return;
        setLoading(false);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const initial = (displayName || email || '?').slice(0, 1).toUpperCase();

  async function handleAvatar(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.show('头像最大 2MB', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setAvatar(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function handleSave(): Promise<void> {
    setSaving(true);
    await new Promise((r) => setTimeout(r, 400));
    setSaving(false);
    toast.show('资料已保存（暂存在本地，后端 API 接入中）');
  }

  async function handleChangePassword(): Promise<void> {
    if (newPassword.length < 8) {
      toast.show('新密码至少 8 位', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.show('两次输入的新密码不一致', 'error');
      return;
    }
    setSaving(true);
    await new Promise((r) => setTimeout(r, 400));
    setSaving(false);
    setPasswordOpen(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    toast.show('密码修改功能后端 API 接入中');
  }

  if (loading) {
    return (
      <PageShell title="个人资料">
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title="个人资料" subtitle="管理你的基本信息" width="3xl">
      <div className="space-y-6">
        <Section>
          <div className="flex flex-col items-start gap-6 md:flex-row md:items-center">
            <div className="relative">
              <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-pink-400 to-pink-600 text-2xl font-semibold text-white">
                {avatar ? (
                  <img src={avatar} alt="" className="h-full w-full object-cover" />
                ) : (
                  initial
                )}
              </div>
              <label className="absolute bottom-0 right-0 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-border bg-card text-foreground shadow-sm transition-colors hover:bg-foreground/5">
                <Camera className="h-3.5 w-3.5" />
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatar}
                />
              </label>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-base font-semibold">{displayName || email}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{email}</div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                支持 JPG/PNG，最大 2MB
              </p>
            </div>
          </div>
        </Section>

        <Section title="基本信息">
          <Row label="昵称" description="显示在左下角和任务通知里">
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="未设置"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:w-64"
            />
          </Row>
          <Row label="邮箱" description="用于登录和安全通知">
            <input
              type="email"
              value={email}
              disabled
              className="w-full rounded-md border border-input bg-muted px-3 py-2 text-sm text-muted-foreground md:w-64"
            />
          </Row>
          <Row label="手机号" description="用于双重验证（可选）">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="未绑定"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:w-64"
            />
          </Row>
          <div className="mt-4 flex justify-end">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? '保存中…' : '保存修改'}
            </Button>
          </div>
        </Section>

        <Section title="账号安全">
          <Row label="密码" description="最近修改：未知">
            {passwordOpen ? (
              <div className="space-y-2">
                <input
                  type="password"
                  placeholder="当前密码"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:w-64"
                />
                <input
                  type="password"
                  placeholder="新密码（至少 8 位）"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:w-64"
                />
                <input
                  type="password"
                  placeholder="确认新密码"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:w-64"
                />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPasswordOpen(false)}
                    disabled={saving}
                  >
                    取消
                  </Button>
                  <Button size="sm" onClick={handleChangePassword} disabled={saving}>
                    {saving ? '提交中…' : '修改密码'}
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setPasswordOpen(true)}>
                修改密码
              </Button>
            )}
          </Row>
          <Row label="双重验证" description="使用手机或邮箱验证码二次确认登录">
            <span className="text-xs text-muted-foreground">即将推出</span>
          </Row>
        </Section>
      </div>
    </PageShell>
  );
}
