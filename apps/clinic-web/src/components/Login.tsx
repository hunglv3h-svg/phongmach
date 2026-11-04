import { useEffect, useState } from 'react';
import { ApiError, api, type AuthState, type DemoTenant, type LoginStep } from '../api';
import { ROLE_LABEL } from '../format';
import { pendingOnDevice, type DevicePending } from '../local/store';
import { expiredText } from '../local/syncList';

type Mode = 'loading' | 'demo' | 'real';

export function Login({
  onLogin,
  notice,
  expired,
}: {
  onLogin: (auth: AuthState) => void;
  notice?: string;
  /** Phiên của người này vừa hết hạn (401): báo số mục của họ còn chờ đồng bộ trên máy (OFF-6). */
  expired?: { tenant: string; userId: string };
}) {
  const [mode, setMode] = useState<Mode>('loading');
  const [tenants, setTenants] = useState<DemoTenant[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  // Trạng thái đăng nhập thật nhiều bước: mật khẩu → (MFA/đăng ký MFA) → (chọn phòng khám).
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<Exclude<LoginStep, { step: 'session' }>>();
  const [code, setCode] = useState('');

  const [pending, setPending] = useState<DevicePending[]>();

  useEffect(() => {
    // demoUsers() 200 ⇒ BFF ở mode demo (hiện danh sách user); 404 ⇒ mode real (form mật khẩu).
    api.demoUsers().then(
      (r) => {
        setTenants(r.tenants);
        setMode('demo');
      },
      () => setMode('real')
    );
    void pendingOnDevice().then(setPending, () => setPending([]));
  }, []);

  const fail = (e: unknown) => {
    setError((e as Error).message);
    setBusy(false);
  };

  const applyStep = (s: LoginStep) => {
    if (s.step === 'session') {
      onLogin({ token: s.token, user: s.user, tenant: s.tenant });
      return;
    }
    setStep(s);
    setBusy(false);
  };

  const pickDemo = async (tenant: string, userId: string) => {
    setBusy(true);
    setError(undefined);
    try {
      onLogin(await api.demoLogin(tenant, userId));
    } catch (e) {
      fail(e);
    }
  };

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      applyStep(await api.login(loginId, password));
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) setError('Quá nhiều lần thử. Vui lòng chờ một phút rồi đăng nhập lại.');
      else fail(err);
      setBusy(false);
    }
  };

  const submitMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!step || step.step === 'choose-tenant') return;
    setBusy(true);
    setError(undefined);
    try {
      const secret = step.step === 'enroll' ? step.secret : undefined;
      applyStep(await api.mfa(step.mfaToken, code, secret));
      setCode('');
    } catch (err) {
      fail(err);
    }
  };

  const chooseTenant = async (slug: string) => {
    if (step?.step !== 'choose-tenant') return;
    setBusy(true);
    setError(undefined);
    try {
      applyStep(await api.selectTenant(step.pretenantToken, slug));
    } catch (err) {
      fail(err);
    }
  };

  const deviceNotes = (
    <>
      {expired && (
        <p className="error" role="alert" data-testid="session-expired">
          {expiredText(pending && (pending.find((p) => p.tenant === expired.tenant && p.userId === expired.userId)?.count ?? 0))}. Dữ liệu trên máy này không mất.
        </p>
      )}
      {(pending ?? []).map((p) => (
        <p key={`${p.tenant}:${p.userId}`} className="offline-note" role="status" data-testid="device-pending" data-user={p.userId} data-count={p.count}>
          Máy này còn {p.count} mục chưa đồng bộ của {p.userName ?? p.userId}. Người đó đăng nhập lại trên máy này thì các mục được gửi tiếp.
        </p>
      ))}
    </>
  );

  if (mode === 'loading') {
    return (
      <main className="login">
        <h1>Đăng nhập</h1>
        {notice && <p className="error" role="alert" data-testid="login-notice">{notice}</p>}
        {deviceNotes}
        <p className="muted">Đang tải…</p>
      </main>
    );
  }

  if (mode === 'real') {
    return (
      <main className="login">
        <h1>Đăng nhập nhân viên</h1>
        {notice && <p className="error" role="alert" data-testid="login-notice">{notice}</p>}
        {deviceNotes}
        {error && <p className="error" role="alert">{error}</p>}
        {!step && (
          <form className="card" onSubmit={submitPassword} data-testid="password-form">
            <label>
              Mã nhân viên hoặc số điện thoại
              <input data-testid="login-id" autoComplete="username" value={loginId} onChange={(ev) => setLoginId(ev.target.value)} required />
            </label>
            <label>
              Mật khẩu
              <input data-testid="login-password" type="password" autoComplete="current-password" value={password} onChange={(ev) => setPassword(ev.target.value)} required />
            </label>
            <button className="user-btn" type="submit" disabled={busy} data-testid="login-submit">Đăng nhập</button>
          </form>
        )}
        {step && (step.step === 'mfa' || step.step === 'enroll') && (
          <form className="card" onSubmit={submitMfa} data-testid="mfa-form">
            {step.step === 'enroll' ? (
              <p className="muted" data-testid="mfa-enroll">
                Tài khoản này bắt buộc dùng xác thực hai bước (TOTP). Quét mã sau vào ứng dụng xác thực rồi nhập mã để hoàn tất đăng ký.
                <br />
                <code data-testid="mfa-otpauth">{step.otpauth}</code>
              </p>
            ) : (
              <p className="muted">Nhập mã 6 số từ ứng dụng xác thực (TOTP).</p>
            )}
            <label>
              Mã xác thực
              <input data-testid="mfa-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(ev) => setCode(ev.target.value)} required />
            </label>
            <button className="user-btn" type="submit" disabled={busy} data-testid="mfa-submit">Xác nhận</button>
          </form>
        )}
        {step?.step === 'choose-tenant' && (
          <section className="card" data-testid="choose-tenant">
            <h2>Chọn phòng khám</h2>
            <ul className="user-list">
              {step.tenants.map((t) => (
                <li key={t.slug}>
                  <button className="user-btn" disabled={busy} onClick={() => void chooseTenant(t.slug)} data-testid={`tenant-${t.slug}`}>
                    {t.name}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    );
  }

  // mode === 'demo'
  return (
    <main className="login">
      <h1>Chọn phòng khám và người dùng</h1>
      <p className="muted">Hai phòng khám demo dùng hai kho dữ liệu tách biệt. Chưa có mật khẩu: đây là bản trình diễn.</p>
      {notice && <p className="error" role="alert" data-testid="login-notice">{notice}</p>}
      {deviceNotes}
      {error && <p className="error" role="alert">{error}</p>}
      {!tenants && <p className="muted">Đang tải…</p>}
      <div className="tenant-grid">
        {tenants?.map((t) => (
          <section key={t.slug} className="card" aria-labelledby={`t-${t.slug}`}>
            <h2 id={`t-${t.slug}`}>{t.name}</h2>
            <ul className="user-list">
              {t.users.map((u) => (
                <li key={u.id}>
                  <button className="user-btn" disabled={busy} onClick={() => pickDemo(t.slug, u.id)} data-testid={`login-${u.id}`}>
                    <span>{u.name}</span>
                    <small>{ROLE_LABEL[u.role]}</small>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
