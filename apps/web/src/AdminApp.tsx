import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { BarChart3, Eye, EyeOff, ScrollText, ShieldCheck, Sparkles, X, Zap } from 'lucide-react';
import { AdminPanel } from './App';
import { api, getAccessToken, jsonBody, setAccessToken } from './api';

type AdminUser = { id: string; email?: string | null; fullName?: string | null; platformRole: string };
type LoginResponse = { accessToken: string; user: AdminUser };

export default function AdminApp() {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(Boolean(getAccessToken()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!getAccessToken()) return;
    api<AdminUser>('/auth/me')
      .then((restoredUser) => {
        if (restoredUser.platformRole === 'platform_admin') setUser(restoredUser);
        else setAccessToken(null);
      })
      .catch(() => setAccessToken(null))
      .finally(() => setCheckingSession(false));
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const values = new FormData(event.currentTarget);
    try {
      const result = await api<LoginResponse>('/auth/login', {
        method: 'POST',
        body: jsonBody({
          email: String(values.get('email') || '').trim().toLowerCase(),
          password: String(values.get('password') || ''),
        }),
      });
      if (result.user.platformRole !== 'platform_admin') {
        setError('Tài khoản này không có quyền quản trị nền tảng.');
        return;
      }
      setAccessToken(result.accessToken);
      setUser(result.user);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể đăng nhập.');
    } finally {
      setBusy(false);
    }
  }

  function signOut() {
    setAccessToken(null);
    setUser(null);
    setNotice('');
  }

  function notify(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => current === message ? '' : current), 4800);
  }

  return <div className="app-shell admin-portal">
    <header className="admin-header">
      <div className="admin-header-inner">
        <span className="admin-brand"><span className="brand-icon">D</span><span>DatSan<small>QUẢN TRỊ NỀN TẢNG</small></span></span>
        {user && <div className="admin-header-actions"><span>{user.fullName || user.email}</span><button className="button quiet small" onClick={signOut}>Đăng xuất</button></div>}
      </div>
    </header>
    {notice && <div className="toast" role="status"><Sparkles size={16} /><span>{notice}</span><button aria-label="Đóng" onClick={() => setNotice('')}><X size={16} /></button></div>}
    {checkingSession ? <main className="admin-login-screen admin-session-check" role="status"><div className="loading-spinner"></div><p>Đang khôi phục phiên đăng nhập…</p></main>
      : user ? <AdminPanel notify={notify} /> : <main className="admin-login-screen">
      <div className="admin-login-copy">
        <span className="eyebrow light">DATSAN / ĐIỀU HÀNH NỀN TẢNG</span>
        <h1>Điều hành<br /><em>mọi trận đấu.</em></h1>
        <p>Trung tâm chỉ huy dành cho quản trị viên nền tảng. Duyệt chủ sân, kiểm duyệt địa điểm, cấu hình danh mục thể thao và theo dõi doanh thu toàn hệ thống.</p>
        <div className="admin-login-badges">
          <span><ShieldCheck size={14} /> Phân quyền đa tầng</span>
          <span><BarChart3 size={14} /> Biểu đồ 6 tháng</span>
          <span><ScrollText size={14} /> Nhật ký thao tác</span>
        </div>
      </div>
      <section className="card admin-login-card">
        <span className="eyebrow">XÁC THỰC QUẢN TRỊ</span>
        <h2>Chào mừng trở lại</h2>
        <p>Đăng nhập bằng tài khoản quản trị viên nền tảng.</p>
        <form className="stack-form" onSubmit={login}>
          <label>Email admin<input name="email" type="email" autoComplete="username" required placeholder="admin@example.com" /></label>
          <label>
            Mật khẩu
            <div className="password-input-wrap">
              <input
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                placeholder="Nhập mật khẩu admin"
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowPassword((prev) => !prev)}
                title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>
          <button className="button primary full" disabled={busy}>{busy ? 'Đang xác thực…' : 'Đăng nhập trang quản trị'}</button>
        </form>
        {error && <p className="form-error" role="alert">{error}</p>}
      </section>
    </main>}
  </div>;
}
