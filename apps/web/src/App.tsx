import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';
import { divIcon, type LatLngExpression } from 'leaflet';
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Banknote,
  Building2,
  Calendar,
  CircleDot,
  ExternalLink,
  Eye,
  EyeOff,
  Flag,
  Flame,
  FlaskConical,
  Grid,
  Inbox,
  LayoutDashboard,
  Map,
  MapPin,
  RotateCw,
  ScrollText,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
  User,
  Users,
  X,
  Zap,
} from 'lucide-react';
import {
  api,
  getAccessToken,
  getZaloAccessToken,
  getZaloLocation,
  getZaloPhone,
  getZaloUserInfo,
  initZaloHeader,
  isZaloMiniApp,
  jsonBody,
  setAccessToken,
} from './api';

type Row = Record<string, any>;
type Sport = { id: string; code: string; name: string; active?: boolean };
type User = { id: string; email?: string | null; phone?: string | null; fullName?: string | null; platformRole: string };
type Business = { id: string; display_name: string; status: string; membership_role: string; review_reason?: string | null };
type View = 'discover' | 'community' | 'bookings' | 'owner' | 'account' | 'admin';

const statusText: Record<string, string> = {
  pending_review: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Cần bổ sung',
  suspended: 'Tạm khóa', draft: 'Bản nháp', pending_payment: 'Chờ thanh toán',
  confirmed: 'Đã xác nhận', cancelled: 'Đã hủy', completed: 'Đã hoàn tất',
  expired: 'Đã hết hạn', open: 'Còn chỗ', full: 'Đã đủ người', closed: 'Đã đóng',
  pending: 'Đang chờ', resolved: 'Đã xử lý', dismissed: 'Đã bỏ qua',
};

function SportIcon({ code, size = 16, className }: { code?: string; size?: number; className?: string }) {
  switch (code) {
    case 'badminton':
      return <Activity size={size} className={className} />;
    case 'football':
      return <CircleDot size={size} className={className} />;
    case 'pickleball':
      return <Target size={size} className={className} />;
    case 'tennis':
      return <Flame size={size} className={className} />;
    default:
      return <Trophy size={size} className={className} />;
  }
}

function today() {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function addDays(value: string, amount: number) {
  const date = new Date(value + 'T12:00:00');
  date.setDate(date.getDate() + amount);
  return date.toISOString().slice(0, 10);
}

function money(value: unknown) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat('vi-VN').format(Number.isFinite(amount) ? amount : 0) + ' ₫';
}

function dateLabel(value: string | Date | undefined, options: Intl.DateTimeFormatOptions = {}) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const format = Object.keys(options).length ? options : { dateStyle: 'medium' as const };
  return date.toLocaleString('vi-VN', format);
}

function queryString(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && String(value).length) params.set(key, String(value));
  });
  return params.toString();
}

function VenueMap({ venues, onOpen, geo }: { venues: Row[]; onOpen: (venue: Row) => void; geo: { latitude: number; longitude: number } | null }) {
  const points = venues.filter((venue) => Number.isFinite(Number(venue.latitude)) && Number.isFinite(Number(venue.longitude)));
  const first = points[0];
  const center: LatLngExpression = geo ? [geo.latitude, geo.longitude] : first ? [Number(first.latitude), Number(first.longitude)] : [10.7769, 106.7009];
  const icon = divIcon({ className: 'datsan-marker', html: '<span></span>', iconSize: [26, 26], iconAnchor: [13, 13] });
  return <div className="map-layout"><MapContainer center={center} zoom={geo || first ? 12 : 6} scrollWheelZoom={false} className="venue-map">
    <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
    {points.map((venue) => <Marker key={venue.id} position={[Number(venue.latitude), Number(venue.longitude)]} icon={icon}><Popup><div className="map-popup"><strong>{venue.name}</strong><span>{venue.address}</span><b>{money(venue.starting_price)} / giờ</b><button onClick={() => onOpen(venue)}>Xem sân <ArrowRight size={13} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: 2 }} /></button></div></Popup></Marker>)}
  </MapContainer><aside className="map-results"><span className="eyebrow">ĐỊA ĐIỂM TRÊN BẢN ĐỒ</span><strong>{points.length} địa điểm có tọa độ</strong>{points.map((venue) => <button key={venue.id} onClick={() => onOpen(venue)}><span>{venue.name}<small>{venue.address}</small></span><b>{money(venue.starting_price)}</b></button>)}{points.length === 0 && <p>Địa điểm chưa có tọa độ. Tìm theo khu vực hoặc mở danh sách để xem địa chỉ.</p>}</aside></div>;
}

function Badge({ value }: { value: string }) {
  return <span className={'badge badge-' + value}>{statusText[value] || value}</span>;
}

function Empty({ title, detail }: { title: string; detail?: string }) {
  return <div className="empty-state"><span className="empty-icon"><Inbox size={16} /></span><strong>{title}</strong>{detail && <p>{detail}</p>}</div>;
}

type ChartPoint = { label: string; value: number };

function compactChartValue(value: number) {
  if (value >= 1_000_000_000) return (value / 1_000_000_000).toFixed(value >= 10_000_000_000 ? 0 : 1) + 'B';
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1) + 'M';
  if (value >= 1_000) return (value / 1_000).toFixed(value >= 10_000 ? 0 : 1) + 'k';
  return String(Math.round(value));
}

function chartLabelVisible(index: number, count: number) {
  const interval = Math.max(1, Math.ceil(count / 7));
  return index % interval === 0 || index === count - 1;
}

function BarChart({ points, ariaLabel, valueFormatter = compactChartValue }: {
  points: ChartPoint[]; ariaLabel: string; valueFormatter?: (value: number) => string;
}) {
  const width = 720, height = 250, left = 48, right = 12, top = 16, bottom = 34;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const maxValue = Math.max(0, ...points.map((point) => Number(point.value) || 0));
  const ceiling = Math.max(4, Math.ceil(maxValue / 4) * 4);
  const slot = plotWidth / Math.max(points.length, 1);
  const barWidth = Math.min(40, Math.max(5, slot * .58));
  return <div className="chart-viewport">
    {points.length ? <svg className="data-chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
      <title>{ariaLabel}</title>
      {[0, 1, 2, 3, 4].map((tick) => {
        const y = top + plotHeight - (tick / 4) * plotHeight;
        return <g key={tick}><line className="chart-grid-line" x1={left} x2={width - right} y1={y} y2={y} /><text className="chart-axis-label" x={left - 8} y={y + 3} textAnchor="end">{compactChartValue(ceiling * tick / 4)}</text></g>;
      })}
      {points.map((point, index) => {
        const value = Math.max(0, Number(point.value) || 0);
        const barHeight = Math.max(2, (value / ceiling) * plotHeight);
        const x = left + slot * index + (slot - barWidth) / 2;
        const y = top + plotHeight - barHeight;
        return <g key={point.label + index}><title>{point.label}: {valueFormatter(value)}</title><rect className={'chart-bar' + (index === points.length - 1 ? ' current' : '')} x={x} y={y} width={barWidth} height={barHeight} rx="6" />{chartLabelVisible(index, points.length) && <text className="chart-x-label" x={x + barWidth / 2} y={height - 9} textAnchor="middle">{point.label}</text>}</g>;
      })}
    </svg> : <div className="chart-no-data">Chưa có dữ liệu trong khoảng thời gian này.</div>}
  </div>;
}

function AreaChart({ points, ariaLabel, valueFormatter = compactChartValue }: {
  points: ChartPoint[]; ariaLabel: string; valueFormatter?: (value: number) => string;
}) {
  const width = 720, height = 250, left = 48, right = 12, top = 16, bottom = 34;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const maxValue = Math.max(0, ...points.map((point) => Number(point.value) || 0));
  const ceiling = Math.max(4, Math.ceil(maxValue / 4) * 4);
  const coordinates = points.map((point, index) => ({
    x: points.length < 2 ? left + plotWidth / 2 : left + (index / (points.length - 1)) * plotWidth,
    y: top + plotHeight - (Math.max(0, Number(point.value) || 0) / ceiling) * plotHeight,
    point,
  }));
  const line = coordinates.map(({ x, y }, index) => `${index ? 'L' : 'M'} ${x} ${y}`).join(' ');
  const area = coordinates.length ? `${line} L ${coordinates[coordinates.length - 1].x} ${top + plotHeight} L ${coordinates[0].x} ${top + plotHeight} Z` : '';
  return <div className="chart-viewport">
    {points.length ? <svg className="data-chart-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
      <title>{ariaLabel}</title>
      {[0, 1, 2, 3, 4].map((tick) => {
        const y = top + plotHeight - (tick / 4) * plotHeight;
        return <g key={tick}><line className="chart-grid-line" x1={left} x2={width - right} y1={y} y2={y} /><text className="chart-axis-label" x={left - 8} y={y + 3} textAnchor="end">{compactChartValue(ceiling * tick / 4)}</text></g>;
      })}
      <path className="chart-area" d={area} />
      <path className="chart-line" d={line} />
      {coordinates.map(({ x, y, point }, index) => <g key={point.label + index}><title>{point.label}: {valueFormatter(Number(point.value) || 0)}</title><circle className="chart-point" cx={x} cy={y} r={points.length > 14 ? 3 : 4} />{chartLabelVisible(index, points.length) && <text className="chart-x-label" x={x} y={height - 9} textAnchor="middle">{point.label}</text>}</g>)}
    </svg> : <div className="chart-no-data">Chưa có dữ liệu trong khoảng thời gian này.</div>}
  </div>;
}

function StatusBreakdown({ label, total, approved, pending }: { label: string; total: number; approved: number; pending: number }) {
  const safeTotal = Math.max(0, total);
  const safeApproved = Math.min(safeTotal, Math.max(0, approved));
  const safePending = Math.min(safeTotal - safeApproved, Math.max(0, pending));
  const other = Math.max(0, safeTotal - safeApproved - safePending);
  const share = (value: number) => safeTotal ? `${value / safeTotal * 100}%` : '0%';
  return <div className="status-breakdown">
    <div className="status-breakdown-heading"><strong>{label}</strong><span>{safeTotal} tổng</span></div>
    <div className="status-stack" aria-label={`${label}: ${safeApproved} đã duyệt, ${safePending} chờ duyệt, ${other} trạng thái khác`}><span className="approved" style={{ width: share(safeApproved) }} /><span className="pending" style={{ width: share(safePending) }} /><span className="other" style={{ width: share(other) }} /></div>
    <div className="status-breakdown-legend"><span><i className="approved" />Đã duyệt <b>{safeApproved}</b></span><span><i className="pending" />Chờ duyệt <b>{safePending}</b></span><span><i className="other" />Khác <b>{other}</b></span></div>
  </div>;
}

function AuthPanel({ onSuccess, initialMode = 'login' }: {
  onSuccess: (result: Row) => void;
  initialMode?: 'login' | 'customer' | 'business';
}) {
  const [mode, setMode] = useState<'login' | 'customer' | 'business'>(initialMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const values = new FormData(event.currentTarget);
    const email = String(values.get('email') || '').trim().toLowerCase();
    const password = String(values.get('password') || '');
    try {
      let result: Row;
      if (mode === 'login') {
        result = await api('/auth/login', { method: 'POST', body: jsonBody({ email, password }) });
      } else if (mode === 'customer') {
        result = await api('/auth/customer/register', {
          method: 'POST',
          body: jsonBody({
            email, password,
            fullName: String(values.get('fullName') || '').trim(),
            phone: String(values.get('phone') || '').trim() || undefined,
          }),
        });
      } else {
        result = await api('/auth/business/register', {
          method: 'POST',
          body: jsonBody({
            email, password,
            fullName: String(values.get('fullName') || '').trim(),
            phone: String(values.get('phone') || '').trim() || undefined,
            businessName: String(values.get('businessName') || '').trim(),
          }),
        });
      }
      onSuccess(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể đăng nhập.');
    } finally {
      setBusy(false);
    }
  }

  async function loginZalo() {
    setBusy(true);
    setError('');
    try {
      const accessToken = await getZaloAccessToken();
      const result = await api('/auth/zalo', { method: 'POST', body: jsonBody({ accessToken }) });
      onSuccess(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể đăng nhập Zalo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-layout">
      <div className="auth-intro">
        <span className="eyebrow">DatSan / TÀI KHOẢN & ĐỒNG BỘ</span>
        <h1>Mỗi trận hay<br /><em>bắt đầu từ một sân.</em></h1>
        <p>Tìm sân phù hợp, giữ lịch nhanh chóng và ghép thêm đồng đội thể thao dễ dàng trên Zalo.</p>
        <div className="auth-points">
          <span>01&nbsp; Khám phá sân trống & giá niêm yết</span>
          <span>02&nbsp; Đặt giữ chỗ tức thì, không trùng giờ</span>
          <span>03&nbsp; Tham gia ghép kèo thể thao sôi động</span>
        </div>
        <div className="auth-perks">
          <span><Zap size={14} /> Đặt sân 30s</span>
          <span><ShieldCheck size={14} /> Chống trùng GiST</span>
          <span><Activity size={14} /> Đa môn thể thao</span>
        </div>
      </div>
      <div className="card auth-card">
        <div className="auth-tabs" role="tablist">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>Đăng nhập</button>
          <button type="button" className={mode === 'customer' ? 'active' : ''} onClick={() => { setMode('customer'); setError(''); }}>Khách hàng</button>
          <button type="button" className={mode === 'business' ? 'active' : ''} onClick={() => { setMode('business'); setError(''); }}>Chủ sân</button>
        </div>
        <h2>{mode === 'login' ? 'Chào mừng trở lại' : mode === 'business' ? 'Đăng ký đối tác chủ sân' : 'Tạo tài khoản người chơi'}</h2>
        <p className="muted">{mode === 'business' ? 'Gửi hồ sơ cụm sân để ban quản trị phê duyệt.' : mode === 'customer' ? 'Tạo tài khoản để đặt sân nhanh và nhận thông báo nhắc lịch.' : 'Đăng nhập để đặt sân nhanh và nhận thông báo nhắc lịch.'}</p>
        <form className="stack-form" onSubmit={submit}>
          {mode !== 'login' && <label>Họ và tên<input name="fullName" autoComplete="name" minLength={2} maxLength={120} required placeholder="Nguyễn Minh Anh" /></label>}
          {mode === 'business' && <label>Tên doanh nghiệp / Cụm sân<input name="businessName" minLength={2} maxLength={160} required placeholder="VD: CLB Thể Thao Sao Vàng..." /></label>}
          <label>Email liên hệ<input name="email" type="email" autoComplete="email" required placeholder="ban@email.com" /></label>
          {mode !== 'login' && <label>Số điện thoại <span className="optional">không bắt buộc</span><input name="phone" type="tel" autoComplete="tel" maxLength={30} placeholder="09xx xxx xxx" /></label>}
          <label>
            Mật khẩu
            <div className="password-input-wrap">
              <input
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                minLength={mode === 'login' ? 1 : 12}
                maxLength={128}
                required
                placeholder={mode === 'login' ? 'Nhập mật khẩu' : 'Tối thiểu 12 ký tự'}
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
          <button className="button primary full auth-submit-btn" disabled={busy}>{busy ? 'Đang xử lý…' : mode === 'login' ? 'Đăng nhập ngay' : 'Hoàn tất đăng ký'}</button>
        </form>
        {mode !== 'business' && (
          <button type="button" className="button zalo full" disabled={busy} onClick={loginZalo}>
            <span className="zalo-mark">Z</span> Tiếp tục với tài khoản Zalo
          </button>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        {mode === 'login' && <p className="fine-print"><a href="/admin/">Cổng quản trị viên nền tảng <ArrowRight size={13} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: 2 }} /></a></p>}
        <p className="fine-print">Thông tin của bạn được bảo mật tuyệt đối theo tiêu chuẩn DatSan.</p>
      </div>
    </section>
  );
}

function Header({ page, setPage, user, businesses, onSignOut, onAccount }: {
  page: View; setPage: (view: View) => void; user: User | null;
  businesses: Business[]; onSignOut: () => void; onAccount: (mode: 'login' | 'business') => void;
}) {
  const hasOwner = businesses.length > 0;
  const isAdmin = user?.platformRole === 'platform_admin';
  return (
    <>
      <header className={page === 'owner' ? 'topbar owner-topbar' : 'topbar'}>
        <button className="brand" onClick={() => setPage('discover')} aria-label="DatSan trang chủ"><span className="brand-icon">D</span><span>DatSan<small>THỂ THAO CÙNG NHAU</small></span></button>
        <nav className="top-nav">
          <button className={page === 'discover' ? 'current' : ''} onClick={() => setPage('discover')}>Tìm sân</button>
          <button className={page === 'community' ? 'current' : ''} onClick={() => setPage('community')}>Ghép kèo</button>
          {user && <button className={page === 'bookings' ? 'current' : ''} onClick={() => setPage('bookings')}>Lịch của tôi</button>}
          {hasOwner && <button className={page === 'owner' ? 'current' : ''} onClick={() => setPage('owner')}>Quản lý sân</button>}
          {isAdmin && <button className={page === 'admin' ? 'current' : ''} onClick={() => setPage('admin')}>Quản trị nền tảng</button>}
        </nav>
        <div className="top-actions">
          {user ? <><span className="user-chip"><span className="avatar">{(user.fullName || user.email || 'D').slice(0, 1).toUpperCase()}</span><span className="user-label">{user.fullName || user.email || 'Tài khoản'}{isAdmin ? ' (Admin)' : ''}</span></span><button className="button quiet small" onClick={onSignOut}>Đăng xuất</button></>
            : <><button className="button quiet small owner-link" onClick={() => onAccount('business')}>Đăng ký chủ sân</button><button className="button primary small" onClick={() => onAccount('login')}>Đăng nhập</button></>}
        </div>
      </header>
      <nav className="mobile-nav" aria-label="Điều hướng chính Mini App">
        <button className={page === 'discover' ? 'active' : ''} onClick={() => setPage('discover')}>
          <span className="mobile-nav-icon"><Search size={18} /></span>
          <span>Tìm sân</span>
        </button>
        <button className={page === 'community' ? 'active' : ''} onClick={() => setPage('community')}>
          <span className="mobile-nav-icon"><Users size={18} /></span>
          <span>Ghép kèo</span>
        </button>
        {user && (
          <button className={page === 'bookings' ? 'active' : ''} onClick={() => setPage('bookings')}>
            <span className="mobile-nav-icon"><Calendar size={18} /></span>
            <span>Lịch của tôi</span>
          </button>
        )}
        {hasOwner && (
          <button className={page === 'owner' ? 'active' : ''} onClick={() => setPage('owner')}>
            <span className="mobile-nav-icon"><Building2 size={18} /></span>
            <span>Chủ sân</span>
          </button>
        )}
        {isAdmin && (
          <button className={page === 'admin' ? 'active' : ''} onClick={() => setPage('admin')}>
            <span className="mobile-nav-icon"><ShieldCheck size={18} /></span>
            <span>Admin</span>
          </button>
        )}
        <button
          className={page === 'account' ? 'active' : ''}
          onClick={() => {
            if (user) setPage(isAdmin ? 'admin' : 'bookings');
            else onAccount('login');
          }}
        >
          <span className="mobile-nav-icon"><User size={18} /></span>
          <span>{user ? 'Cá nhân' : 'Tài khoản'}</span>
        </button>
      </nav>
    </>
  );
}

function ExplorePanel({ sports, user, onLogin, onOpenBookings, notify }: {
  sports: Sport[]; user: User | null; onLogin: () => void; onOpenBookings: () => void; notify: (message: string) => void;
}) {
  const [venues, setVenues] = useState<Row[]>([]);
  const [search, setSearch] = useState('');
  const [sport, setSport] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [searchDate, setSearchDate] = useState('');
  const [searchTime, setSearchTime] = useState('');
  const [maxDistanceKm, setMaxDistanceKm] = useState('');
  const [geo, setGeo] = useState<{ latitude: number; longitude: number } | null>(null);
  const [selected, setSelected] = useState<Row | null>(null);
  const [courtId, setCourtId] = useState('');
  const [date, setDate] = useState(today());
  const [duration, setDuration] = useState(60);
  const [slots, setSlots] = useState<Row[]>([]);
  const [slot, setSlot] = useState<Row | null>(null);
  const [payment, setPayment] = useState<'onsite' | 'demo'>('onsite');
  const [contactName, setContactName] = useState(user?.fullName || '');
  const [contactPhone, setContactPhone] = useState(user?.phone || '');
  const [contactEmail, setContactEmail] = useState(user?.email || '');
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [resultView, setResultView] = useState<'list' | 'map'>('list');
  const chosenCourt = selected?.courts?.find((court: Row) => court.id === courtId);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      const query = queryString({
        sport: sport || undefined, q: search || undefined, maxPrice: maxPrice || undefined,
        date: searchDate || undefined, startTime: searchTime || undefined,
        latitude: geo?.latitude, longitude: geo?.longitude,
        maxDistanceKm: geo && maxDistanceKm ? maxDistanceKm : undefined,
      });
      api<Row[]>('/venues' + (query ? '?' + query : ''))
        .then((result) => { if (!cancelled) setVenues(result); })
        .catch((cause) => { if (!cancelled) { setVenues([]); notify(cause instanceof Error ? cause.message : 'Không tải được danh sách sân.'); } })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 220);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [sport, search, maxPrice, searchDate, searchTime, maxDistanceKm, geo?.latitude, geo?.longitude]);

  useEffect(() => {
    setContactName(user?.fullName || '');
    setContactPhone(user?.phone || '');
    setContactEmail(user?.email || '');
  }, [user]);
  useEffect(() => {
    if (!selected || !courtId) { setSlots([]); return; }
    let mounted = true;
    const query = queryString({ date, durationMinutes: duration });
    api<Row>('/venues/' + selected.id + '/courts/' + courtId + '/availability?' + query)
      .then((result) => { if (mounted) setSlots(result.slots || []); })
      .catch((cause) => { if (mounted) { setSlots([]); notify(cause instanceof Error ? cause.message : 'Không tải được khung giờ.'); } });
    return () => { mounted = false; };
  }, [selected?.id, courtId, date, duration]);

  async function openVenue(venue: Row) {
    try {
      const result = await api<Row>('/venues/' + venue.id);
      setSelected(result);
      const firstCourt = result.courts?.find((court: Row) => !sport || court.sport_code === sport);
      setCourtId(firstCourt?.id || '');
      setDuration(Number(firstCourt?.default_duration_minutes || 60));
      setDate(searchDate || today());
      setSlot(null);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Không mở được chi tiết sân.');
    }
  }

  async function useLocation() {
    setLocating(true);
    try {
      const coords = await getZaloLocation();
      setGeo(coords);
      notify('Đã lấy vị trí thành công. Sân đang được sắp theo khoảng cách gần bạn nhất.');
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Không thể xác định vị trí.');
    } finally {
      setLocating(false);
    }
  }

  async function book() {
    if (!user) { onLogin(); return; }
    if (!selected || !chosenCourt || !slot) return;
    try {
      const result = await api<Row>('/bookings/courts/' + chosenCourt.id, {
        method: 'POST',
        body: jsonBody({
          date, startTime: slot.startTime, durationMinutes: Number(duration),
          paymentMethod: payment, contactName, contactPhone, contactEmail: contactEmail || undefined,
        }),
      });
      notify(payment === 'demo' ? 'Đã giữ chỗ. Hoàn tất bước thanh toán thử nghiệm trong Lịch của tôi.' : 'Đặt sân thành công. Lịch đã được xác nhận.');
      setSelected(null);
      setSlot(null);
      onOpenBookings();
      if (result.status === 'pending_payment') window.setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 50);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Không tạo được lượt đặt.');
    }
  }

  return (
    <main className="page-wrap">
      {selected ? (
        <section className="venue-detail">
          <button className="back-link" onClick={() => { setSelected(null); setSlot(null); }}><ArrowLeft size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} /> Tất cả sân</button>
          <div className="detail-hero">
            <div className="detail-photo" style={selected.media?.[0]?.url ? { backgroundImage: 'linear-gradient(180deg, transparent, rgba(0,0,0,.28)), url(' + selected.media[0].url + ')' } : undefined}>
              {!selected.media?.[0]?.url && <span className="photo-mark">DS</span>}
              <span className="photo-chip">{selected.sports?.map((item: Row) => item.name).join(' · ')}</span>
            </div>
            <div className="detail-copy">
              <span className="eyebrow">ĐỊA ĐIỂM THỂ THAO</span>
              <h1>{selected.name}</h1>
              <p className="address-line"><MapPin size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} /> {selected.address}</p>
              <p>{selected.description || 'Chọn sân và khung giờ để xem giá chính xác.'}</p>
              <div className="detail-links">
                <a href={'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(selected.latitude && selected.longitude ? selected.latitude + ',' + selected.longitude : selected.address)} target="_blank" rel="noreferrer">Mở bản đồ <ExternalLink size={12} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: 3 }} /></a>
                <span>{selected.business_name}</span>
              </div>
            </div>
          </div>
          <div className="detail-grid">
            <section className="card booking-builder">
              <div className="section-heading"><div><span className="eyebrow">ĐẶT SÂN</span><h2>Chọn khung giờ</h2></div><span className="step-bubble">01 / 03</span></div>
              <div className="form-grid two">
                <label>Sân<select value={courtId} onChange={(event) => { const id = event.target.value; setCourtId(id); const c = selected.courts?.find((item: Row) => item.id === id); setDuration(Number(c?.default_duration_minutes || 60)); setSlot(null); }}>
                  {selected.courts?.map((court: Row) => <option value={court.id} key={court.id}>{court.name} · {court.sport_name}</option>)}
                </select></label>
                <label>Ngày<input type="date" min={today()} value={date} onChange={(event) => { setDate(event.target.value); setSlot(null); }} /></label>
                <label>Thời lượng<select value={duration} onChange={(event) => { setDuration(Number(event.target.value)); setSlot(null); }}>
                  {chosenCourt && Array.from({ length: Math.floor((Number(chosenCourt.maximum_duration_minutes) - Number(chosenCourt.minimum_duration_minutes)) / Number(chosenCourt.slot_interval_minutes)) + 1 }, (_, index) => Number(chosenCourt.minimum_duration_minutes) + index * Number(chosenCourt.slot_interval_minutes)).map((minutes) => <option value={minutes} key={minutes}>{minutes / 60} giờ</option>)}
                </select></label>
                <div className="date-note"><span className="spark"><Sparkles size={14} /></span><span>Giá và chỗ trống được xác nhận lại khi đặt.</span></div>
              </div>
              <div className="slot-title"><strong>Khung giờ còn trống</strong><span>{slots.length} lựa chọn</span></div>
              {slots.length ? <div className="slot-grid">{slots.map((item) => <button key={item.startAt} className={'slot-card ' + (slot?.startAt === item.startAt ? 'selected' : '')} onClick={() => setSlot(item)}><strong>{item.startTime}</strong><small>{item.endTime}</small><b>{money(item.totalPrice)}</b></button>)}</div>
                : <Empty title="Chưa có khung giờ trống" detail="Chọn ngày khác hoặc thử thời lượng ngắn hơn." />}
              {slot && <div className="checkout">
                <div className="checkout-top"><span>Giờ đã chọn</span><strong>{slot.startTime} – {slot.endTime} · {money(slot.totalPrice)}</strong></div>
                <div className="form-grid two">
                  <label>
                    <span className="control-label-row">
                      <span>Người liên hệ</span>
                      {!contactName && (
                        <button
                          type="button"
                          className="inline-zalo-link"
                          onClick={async () => {
                            try {
                              const info = await getZaloUserInfo();
                              if (info?.name) {
                                setContactName(info.name);
                                notify('Đã lấy họ tên từ Zalo: ' + info.name);
                              }
                            } catch {}
                          }}
                        >
                          <span className="zalo-mark-mini">Z</span> Lấy tên từ Zalo
                        </button>
                      )}
                    </span>
                    <input value={contactName} onChange={(event) => setContactName(event.target.value)} required placeholder="Họ và tên" />
                  </label>
                  <label>
                    <span className="control-label-row">
                      <span>Số điện thoại</span>
                      <button
                        type="button"
                        className="inline-zalo-link"
                        onClick={async () => {
                          try {
                            const phone = await getZaloPhone();
                            if (phone) {
                              setContactPhone(phone);
                              notify('Đã lấy số điện thoại từ Zalo: ' + phone);
                            }
                          } catch (cause) {
                            notify(cause instanceof Error ? cause.message : 'Không lấy được số từ Zalo.');
                          }
                        }}
                      >
                        <span className="zalo-mark-mini">Z</span> Lấy số từ Zalo
                      </button>
                    </span>
                    <input type="tel" value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} required minLength={6} maxLength={30} placeholder="09xx xxx xxx" />
                  </label>
                  <label className="wide">Email nhận xác nhận <span className="optional">không bắt buộc</span><input type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} placeholder="ban@email.com" /></label>
                  <div className="wide">
                    <span className="control-label">PHƯƠNG THỨC THANH TOÁN</span>
                    <div className="payment-options-grid">
                      <button
                        type="button"
                        className={'payment-option-card ' + (payment === 'onsite' ? 'active' : '')}
                        onClick={() => setPayment('onsite')}
                      >
                        <span className="payment-option-icon"><Banknote size={22} /></span>
                        <div>
                          <strong>Thanh toán tại sân</strong>
                          <small>Xác nhận ngay, gửi email xác nhận</small>
                        </div>
                      </button>
                      <button
                        type="button"
                        className={'payment-option-card ' + (payment === 'demo' ? 'active' : '')}
                        onClick={() => setPayment('demo')}
                      >
                        <span className="payment-option-icon"><FlaskConical size={22} /></span>
                        <div>
                          <strong>Thanh toán thử nghiệm (Demo)</strong>
                          <small>Giữ chỗ 10 phút, mô phỏng duyệt thanh toán</small>
                        </div>
                      </button>
                    </div>
                  </div>
                </div>
                <button className="button primary full checkout-submit-btn" onClick={() => void book()} disabled={!contactName.trim() || contactPhone.trim().length < 6}>Xác nhận đặt sân · {money(slot.totalPrice)}</button>
                {!user && <p className="fine-print">Bạn cần đăng nhập trước khi xác nhận.</p>}
              </div>}
            </section>
            <aside className="card venue-side">
              <span className="eyebrow">THÔNG TIN SÂN</span>
              <h3>{selected.courts?.length || 0} sân đang hoạt động</h3>
              <div className="court-list">{selected.courts?.map((court: Row) => <button key={court.id} className={'court-row ' + (courtId === court.id ? 'active' : '')} onClick={() => { setCourtId(court.id); setDuration(Number(court.default_duration_minutes || 60)); setSlot(null); }}><span><strong>{court.name}</strong><small>{court.sport_name}{court.court_type ? ' · ' + court.court_type : ''}</small></span><span><ArrowRight size={14} /></span></button>)}</div>
              <div className="side-note"><strong>Chính sách đặt chỗ</strong><p>Giữ lịch theo thời gian thực. Địa điểm sẽ xác nhận thông tin qua email nếu bạn cung cấp.</p></div>
            </aside>
          </div>
        </section>
      ) : (
        <>
          <section className="hero">
            <div className="hero-copy"><span className="eyebrow light">SÂN CHƠI CỦA BẠN, Ở GẦN HƠN</span><h1>Chọn sân.<br /><em>Vào trận.</em></h1><p>Tìm khung giờ phù hợp cho đội của bạn — rõ giá, đặt nhanh.</p><div className="hero-meta"><span><b>01</b> Tìm theo môn</span><span><b>02</b> Xem giờ trống</span><span><b>03</b> Đặt là chơi</span></div></div>
            <div className="hero-art"><div className="court-lines"><span></span><span></span><span></span><span></span><i></i></div><div className="hero-ball">DS</div><div className="hero-caption">TẬP HỢP ĐỘI<br />BẮT ĐẦU TRẬN ĐẤU</div></div>
            <div className="hero-stamp">CHƠI<br />THÔI!</div>
          </section>
          <section className="search-panel">
            <div className="search-head"><div><span className="eyebrow">KHÁM PHÁ</span><h2>Tìm sân phù hợp</h2></div><button className="location-button" disabled={locating} onClick={useLocation}><MapPin size={14} /> <span className="location-long">{locating ? 'Đang xác định vị trí…' : geo ? 'Đang sắp theo vị trí' : 'Gần vị trí của tôi'}</span><span className="location-short">{locating ? 'Đang tìm…' : geo ? 'Theo vị trí' : 'Gần tôi'}</span></button></div>
            <div className="sport-chips-bar" role="tablist" aria-label="Lọc theo môn thể thao">
              <button
                type="button"
                className={'sport-chip ' + (!sport ? 'active' : '')}
                onClick={() => setSport('')}
              >
                <span className="sport-chip-emoji"><Trophy size={14} /></span>
                <span>Tất cả môn</span>
              </button>
              {sports.filter((item) => item.active !== false).map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={'sport-chip ' + (sport === item.code ? 'active' : '')}
                  onClick={() => setSport(sport === item.code ? '' : item.code)}
                >
                  <span className="sport-chip-emoji"><SportIcon code={item.code} size={14} /></span>
                  <span>{item.name}</span>
                </button>
              ))}
            </div>
            <div className="search-controls">
              <label className="search-input"><span><Search size={16} /></span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tên sân, quận hoặc khu vực" /></label>
              <label><span className="control-label">MÔN THỂ THAO</span><select value={sport} onChange={(event) => setSport(event.target.value)}><option value="">Tất cả môn</option>{sports.filter((item) => item.active !== false).map((item) => <option value={item.code} key={item.id}>{item.name}</option>)}</select></label>
              <label><span className="control-label">GIÁ TỐI ĐA / GIỜ</span><select value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)}><option value="">Không giới hạn</option><option value="100000">100.000 ₫</option><option value="200000">200.000 ₫</option><option value="350000">350.000 ₫</option><option value="500000">500.000 ₫</option></select></label>
              <label><span className="control-label">NGÀY CHƠI</span><input type="date" min={today()} value={searchDate} onChange={(event) => { setSearchDate(event.target.value); if (!event.target.value) setSearchTime(''); }} /></label>
              <label><span className="control-label">GIỜ BẮT ĐẦU (ĐỂ TRỐNG = CẢ NGÀY)</span><input type="time" step={900} value={searchTime} onChange={(event) => { setSearchTime(event.target.value); if (event.target.value && !searchDate) setSearchDate(today()); }} /></label>
              <label><span className="control-label">KHOẢNG CÁCH</span><select value={maxDistanceKm} onChange={(event) => setMaxDistanceKm(event.target.value)} disabled={!geo}><option value="">{geo ? 'Không giới hạn' : 'Bật vị trí để lọc'}</option><option value="3">Trong 3 km</option><option value="5">Trong 5 km</option><option value="10">Trong 10 km</option><option value="20">Trong 20 km</option></select></label>
            </div>
          </section>
          <section className="results-section">
            <div className="results-head"><div><span className="eyebrow">LỰA CHỌN CỦA BẠN</span><h2>{loading ? 'Đang tìm sân…' : venues.length + ' địa điểm phù hợp'}</h2></div><div className="results-tools"><div className="view-toggle"><button className={resultView === 'list' ? 'active' : ''} onClick={() => setResultView('list')}><Grid size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} /> Danh sách</button><button className={resultView === 'map' ? 'active' : ''} onClick={() => setResultView('map')}><Map size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} /> Bản đồ</button></div><span className="results-note">Địa điểm đã duyệt</span></div></div>
            {venues.length && resultView === 'map' ? <VenueMap venues={venues} geo={geo} onOpen={openVenue} /> : venues.length ? <div className="venue-grid">{venues.map((venue) => <article className="venue-card" key={venue.id}>
              <button className="venue-card-image" onClick={() => void openVenue(venue)}>{venue.media_urls?.[0] ? <img src={venue.media_urls[0]} alt="" /> : <span className="venue-image-mark">DS<span>SPORTS CLUB</span></span>}<span className="price-tag">Từ {money(venue.starting_price)}<small>/ giờ</small></span></button>
              <div className="venue-card-body"><div className="venue-card-top"><div><span className="venue-sports">{(venue.sport_codes || []).map((code: string) => sports.find((item) => item.code === code)?.name || code).join(' · ')}</span><h3>{venue.name}</h3></div><span className="card-arrow"><ArrowRight size={15} /></span></div><p className="venue-address"><MapPin size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 3 }} /> {venue.address}</p><div className="venue-card-footer"><span>{venue.distance_km ? Number(venue.distance_km).toFixed(1) + ' km' : 'Giờ trống hôm nay'}</span><button onClick={() => void openVenue(venue)}>Xem sân <ArrowRight size={12} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: 4 }} /></button></div></div>
            </article>)}</div> : <Empty title={loading ? 'Đang tải sân…' : 'Chưa tìm thấy địa điểm'} detail="Thử bỏ bớt bộ lọc hoặc tìm bằng một khu vực khác." />}
          </section>
          <section className="community-promo"><div><span className="eyebrow light">CHƠI CÙNG NHAU</span><h2>Thiếu người? <em>Ghép kèo thôi.</em></h2><p>Tạo trận, chọn sân và tìm thêm đồng đội.</p></div><button className="button pale" onClick={() => window.dispatchEvent(new CustomEvent('datsan:navigate', { detail: 'community' }))}>Khám phá cộng đồng <ArrowRight size={14} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: 4 }} /></button></section>
        </>
      )}
    </main>
  );
}

function BookingPanel({ user, onUserUpdated, notify }: { user: User; onUserUpdated: (user: User) => void; notify: (message: string) => void }) {
  const [bookings, setBookings] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [profileName, setProfileName] = useState(user.fullName || '');
  const [profileEmail, setProfileEmail] = useState(user.email || '');
  const [profilePhone, setProfilePhone] = useState(user.phone || '');

  async function load() {
    setLoading(true);
    try { setBookings(await api<Row[]>('/bookings/mine')); }
    catch (cause) { notify(cause instanceof Error ? cause.message : 'Không tải được lịch đặt.'); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    setProfileName(user.fullName || '');
    setProfileEmail(user.email || '');
    setProfilePhone(user.phone || '');
  }, [user]);

  async function updateProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const updated = await api<User>('/auth/me', { method: 'PATCH', body: jsonBody({ fullName: profileName, email: profileEmail || undefined, phone: profilePhone || undefined }) });
      onUserUpdated(updated);
      notify('Đã cập nhật thông tin tài khoản.');
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Không cập nhật được hồ sơ.'); }
  }

  async function cancelBooking(id: string) {
    if (!window.confirm('Bạn muốn hủy lượt đặt này?')) return;
    setBusyId(id);
    try { await api('/bookings/' + id + '/cancel', { method: 'POST' }); notify('Đã hủy lịch đặt.'); await load(); }
    catch (cause) { notify(cause instanceof Error ? cause.message : 'Không hủy được lịch.'); }
    finally { setBusyId(''); }
  }

  async function payDemo(id: string, outcome: 'succeeded' | 'failed') {
    setBusyId(id);
    try { await api('/bookings/' + id + '/demo-payment', { method: 'POST', body: jsonBody({ outcome }) }); notify(outcome === 'succeeded' ? 'Thanh toán demo thành công, lịch đã xác nhận.' : 'Thanh toán demo thất bại, khung giờ được giải phóng.'); await load(); }
    catch (cause) { notify(cause instanceof Error ? cause.message : 'Không xử lý được thanh toán.'); }
    finally { setBusyId(''); }
  }

  return <main className="page-wrap">
    <div className="page-title-row"><div><span className="eyebrow">TÀI KHOẢN KHÁCH</span><h1>Lịch của tôi</h1><p>Theo dõi lượt đặt, trạng thái thanh toán và thông tin liên hệ.</p></div><span className="large-index">01—04</span></div>
    <div className="account-grid">
      <section className="card profile-card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">THÔNG TIN CỦA BẠN</span>
            <h2>Hồ sơ liên hệ</h2>
          </div>
          <button
            type="button"
            className="button quiet small"
            onClick={async () => {
              try {
                const [info, phone] = await Promise.all([getZaloUserInfo(), getZaloPhone()]);
                if (info?.name) setProfileName(info.name);
                if (phone) setProfilePhone(phone);
                notify('Đã đồng bộ thông tin từ Zalo.');
              } catch (cause) {
                notify(cause instanceof Error ? cause.message : 'Không thể lấy thông tin từ Zalo.');
              }
            }}
          >
            <span className="zalo-mark-mini">Z</span> Đồng bộ Zalo
          </button>
        </div>
        <form className="stack-form" onSubmit={updateProfile}>
          <label>Họ và tên<input value={profileName} onChange={(event) => setProfileName(event.target.value)} minLength={2} required /></label>
          <label>Email<input type="email" value={profileEmail} onChange={(event) => setProfileEmail(event.target.value)} placeholder="Nhận xác nhận và nhắc lịch" /></label>
          <label>
            <span className="control-label-row">
              <span>Số điện thoại</span>
              <button
                type="button"
                className="inline-zalo-link"
                onClick={async () => {
                  try {
                    const phone = await getZaloPhone();
                    if (phone) {
                      setProfilePhone(phone);
                      notify('Đã lấy số từ Zalo: ' + phone);
                    }
                  } catch (cause) {
                    notify(cause instanceof Error ? cause.message : 'Không lấy được số từ Zalo.');
                  }
                }}
              >
                <span className="zalo-mark-mini">Z</span> Lấy số Zalo
              </button>
            </span>
            <input type="tel" value={profilePhone} onChange={(event) => setProfilePhone(event.target.value)} maxLength={30} />
          </label>
          <button className="button outline full">Lưu hồ sơ</button>
        </form>
        <p className="fine-print">Email nhắc lịch chỉ được gửi khi đã cấu hình máy chủ SMTP và bạn cung cấp email.</p>
      </section>
      <section className="booking-list-area"><div className="section-heading"><div><span className="eyebrow">LỊCH SÂN</span><h2>Đặt chỗ gần đây</h2></div><button className="button quiet small" onClick={() => void load()}><RotateCw size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} /> Làm mới</button></div>
        {loading ? <Empty title="Đang tải lịch…" /> : bookings.length ? <div className="booking-list">{bookings.map((booking) => <article className="card booking-card" key={booking.id}><div className="booking-date"><strong>{new Date(booking.start_at).toLocaleDateString('vi-VN', { day: '2-digit' })}</strong><span>TH{new Date(booking.start_at).getMonth() + 1}</span></div><div className="booking-info"><div className="booking-title"><div><h3>{booking.venue_name}</h3><p>{booking.court_name} · {dateLabel(booking.start_at, { hour: '2-digit', minute: '2-digit' })}</p></div><Badge value={booking.status} /></div><p className="booking-address">{booking.address}</p><div className="booking-bottom"><span>{money(booking.total_price)} <small>· {booking.payment_method === 'demo' ? 'Thanh toán demo' : 'Tại sân'}</small></span><div className="booking-actions">
          {booking.status === 'pending_payment' && <><button className="button primary small" disabled={busyId === booking.id} onClick={() => void payDemo(booking.id, 'succeeded')}>Thanh toán demo</button><button className="button quiet small" disabled={busyId === booking.id} onClick={() => void payDemo(booking.id, 'failed')}>Thử thất bại</button></>}
          {(booking.status === 'confirmed' || booking.status === 'pending_payment') && <button className="text-button danger-text" disabled={busyId === booking.id} onClick={() => void cancelBooking(booking.id)}>Hủy lịch</button>}
        </div></div></div></article>)}</div> : <Empty title="Bạn chưa có lượt đặt nào" detail="Chọn một sân và khung giờ trống để bắt đầu." />}
      </section>
    </div>
  </main>;
}

function CommunityPanel({ sports, user, onLogin, notify }: {
  sports: Sport[]; user: User | null; onLogin: () => void; notify: (message: string) => void;
}) {
  const [games, setGames] = useState<Row[]>([]);
  const [venues, setVenues] = useState<Row[]>([]);
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [participants, setParticipants] = useState<Record<string, Row[]>>({});
  const [sport, setSport] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [allGames, locations] = await Promise.all([api<Row[]>('/community/games' + (sport ? '?sport=' + encodeURIComponent(sport) : '')), api<Row[]>('/venues')]);
      setGames(allGames); setVenues(locations);
      if (user) {
        const myGames = await api<Row[]>('/community/games/mine');
        setMine(new Set(myGames.map((game) => game.id)));
      } else setMine(new Set());
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Không tải được cộng đồng.'); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [sport, user?.id]);

  async function createGame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) { onLogin(); return; }
    const data = new FormData(event.currentTarget);
    const startsAt = new Date(String(data.get('startsAt'))).toISOString();
    try {
      await api('/community/games', { method: 'POST', body: jsonBody({ venueId: data.get('venueId'), sportCode: data.get('sportCode'), startsAt, targetPlayers: Number(data.get('targetPlayers')), note: String(data.get('note') || '') || undefined }) });
      notify('Đã tạo kèo. Bạn đã được thêm làm người tham gia đầu tiên.');
      await load();
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Không tạo được kèo.'); }
  }

  async function changeMembership(game: Row, action: 'join' | 'leave' | 'close') {
    if (!user) { onLogin(); return; }
    try {
      if (action === 'join') await api('/community/games/' + game.id + '/join', { method: 'POST' });
      if (action === 'leave') await api('/community/games/' + game.id + '/join', { method: 'DELETE' });
      if (action === 'close') await api('/community/games/' + game.id + '/close', { method: 'POST' });
      notify(action === 'join' ? 'Bạn đã tham gia kèo.' : action === 'leave' ? 'Bạn đã rời kèo.' : 'Đã đóng kèo.');
      await load();
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Không cập nhật được kèo.'); }
  }

  async function toggleParticipants(game: Row) {
    if (participants[game.id]) { const next = { ...participants }; delete next[game.id]; setParticipants(next); return; }
    try {
      const detail = await api<Row>('/community/games/' + game.id);
      setParticipants((current) => ({ ...current, [game.id]: detail.participants || [] }));
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Không tải được danh sách người chơi.'); }
  }
  async function report(game: Row) {
    if (!user) { onLogin(); return; }
    const reason = window.prompt('Lý do báo cáo bài ghép kèo:');
    if (!reason?.trim()) return;
    try { await api('/community/games/' + game.id + '/report', { method: 'POST', body: jsonBody({ reason: reason.trim() }) }); notify('Đã gửi báo cáo cho admin.'); }
    catch (cause) { notify(cause instanceof Error ? cause.message : 'Không gửi được báo cáo.'); }
  }

  const eligibleVenues = useMemo(() => venues.filter((venue) => !sport || (venue.sport_codes || []).includes(sport)), [venues, sport]);
  return <main className="page-wrap">
    <section className="community-hero"><div><span className="eyebrow light">CỘNG ĐỒNG DATSAN</span><h1>Thêm người.<br /><em>Thêm trận hay.</em></h1><p>Tìm đội chơi cùng, cùng môn và cùng khung giờ.</p></div><div className="community-mark"><span>CHƠI<br />CÓ HỘI</span><Users size={32} /></div></section>
    <div className="community-layout">
      <section className="community-main"><div className="section-heading"><div><span className="eyebrow">TRẬN SẮP TỚI</span><h2>{games.length} kèo đang mở</h2></div><label className="compact-select"><select value={sport} onChange={(event) => setSport(event.target.value)}><option value="">Tất cả môn</option>{sports.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select></label></div>
        {loading ? <Empty title="Đang tìm kèo…" /> : games.length ? <div className="game-list">{games.map((game) => {
          const isMine = mine.has(game.id);
          const isOrganizer = game.organizer_id === user?.id;
          return <article className="card game-card" key={game.id}>
            <div className="game-date"><span>{new Date(game.starts_at).toLocaleDateString('vi-VN', { weekday: 'short' }).toUpperCase()}</span><strong>{new Date(game.starts_at).getDate()}</strong><small>TH{new Date(game.starts_at).getMonth() + 1}</small></div>
            <div className="game-info">
              <div className="game-title"><div><span className="sport-pill">{game.sport_name}</span><h3>{game.venue_name}</h3></div><Badge value={game.status} /></div>
              <p className="game-location"><MapPin size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 3 }} /> {game.address}</p>
              <div className="game-capacity-wrap">
                <div className="game-capacity-bar">
                  <div
                    className="game-capacity-fill"
                    style={{ width: `${Math.min(100, Math.round(((Number(game.joined_players) || 1) / (Number(game.target_players) || 2)) * 100))}%` }}
                  ></div>
                </div>
                <span className="game-capacity-label">{game.joined_players}/{game.target_players} người ({Math.round(((Number(game.joined_players) || 1) / (Number(game.target_players) || 2)) * 100)}%)</span>
              </div>
              <p className="game-meta">{dateLabel(game.starts_at, { hour: '2-digit', minute: '2-digit' })} · Tổ chức bởi {game.organizer_name}</p>
              <button className="text-button participants-trigger" onClick={() => void toggleParticipants(game)}>{participants[game.id] ? 'Ẩn người chơi' : 'Xem người chơi'}</button>
              {participants[game.id] && <div className="participant-list">{participants[game.id].map((person) => <span key={person.userId}>{person.fullName || 'Người chơi DatSan'}</span>)}</div>}
              {game.note && <p className="game-note">“{game.note}”</p>}
              <div className="game-actions">
                {isOrganizer ? <button className="button quiet small" onClick={() => void changeMembership(game, 'close')}>Đóng kèo</button>
                  : isMine ? <button className="button outline small" onClick={() => void changeMembership(game, 'leave')}>Rời kèo</button>
                  : game.status === 'open' && <button className="button primary small" onClick={() => void changeMembership(game, 'join')}>Tham gia kèo</button>}
                <button className="text-button" onClick={() => void report(game)}>Báo cáo</button>
              </div>
            </div>
          </article>;
        })}</div> : <Empty title="Chưa có kèo phù hợp" detail="Bạn có thể tạo kèo mới để tìm thêm đồng đội." />}
      </section>
      <aside className="card create-game-card"><span className="eyebrow">TỔ CHỨC TRẬN</span><h2>Tạo một kèo mới</h2><p className="muted">Bạn sẽ được tính là người tham gia đầu tiên.</p><form className="stack-form" onSubmit={createGame}>
        <label>Môn thể thao<select name="sportCode" required value={sport} onChange={(event) => setSport(event.target.value)}><option value="">Chọn môn</option>{sports.filter((item) => item.active !== false).map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</select></label>
        <label>Địa điểm<select name="venueId" required defaultValue=""><option value="" disabled>Chọn sân đã duyệt</option>{eligibleVenues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name} · {venue.address}</option>)}</select></label>
        <label>Thời gian<input name="startsAt" type="datetime-local" min={new Date(Date.now() + 30 * 60000).toISOString().slice(0, 16)} required /></label>
        <label>Tổng số người<select name="targetPlayers" defaultValue="4">{[2, 4, 6, 8, 10, 12, 16].map((count) => <option key={count} value={count}>{count} người</option>)}</select></label>
        <label>Ghi chú <span className="optional">không bắt buộc</span><textarea name="note" rows={3} maxLength={1000} placeholder="Trình độ, chia tiền sân, dụng cụ..." /></label>
        <button className="button primary full">Tạo kèo</button>
      </form></aside>
    </div>
  </main>;
}

function OwnerPanel({ businesses, sports, notify }: { businesses: Business[]; sports: Sport[]; notify: (message: string) => void }) {
  const [businessId, setBusinessId] = useState(businesses[0]?.id || '');
  const [createVenueOpen, setCreateVenueOpen] = useState(false);
  const [venues, setVenues] = useState<Row[]>([]);
  const [selectedVenueId, setSelectedVenueId] = useState('');
  const [selectedCourtId, setSelectedCourtId] = useState('');
  const [editingCourt, setEditingCourt] = useState<Row | null>(null);
  const [bookings, setBookings] = useState<Row[]>([]);
  const [blocks, setBlocks] = useState<Row[]>([]);
  const [staff, setStaff] = useState<Row[]>([]);
  const [calendarDate, setCalendarDate] = useState(today());
  const [reportFrom, setReportFrom] = useState(today());
  const [reportTo, setReportTo] = useState(addDays(today(), 6));
  const [report, setReport] = useState<Row | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const business = businesses.find((item) => item.id === businessId);
  const venue = venues.find((item) => item.id === selectedVenueId);
  const selectedCourt = venue?.courts?.find((item: Row) => item.id === selectedCourtId);
  const manager = business?.membership_role !== 'staff';
  const weekEnd = addDays(calendarDate, 6);

  async function loadVenues() {
    if (!businessId) return;
    try {
      const result = await api<Row[]>('/owner/businesses/' + businessId + '/venues');
      setVenues(result);
      if (!result.some((item) => item.id === selectedVenueId)) setSelectedVenueId(result[0]?.id || '');
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Không tải được địa điểm.'); }
  }

  async function loadStaff() {
    if (!businessId) return;
    try { setStaff(await api<Row[]>('/owner/businesses/' + businessId + '/staff')); }
    catch { setStaff([]); }
  }

  async function loadReport() {
    if (!businessId || !manager || business?.status !== 'approved') return;
    setReportLoading(true);
    setReport(null);
    try {
      const q = queryString({ from: reportFrom, to: reportTo });
      setReport(await api<Row>('/owner/businesses/' + businessId + '/reports?' + q));
    } catch (cause) { setReport(null); notify(cause instanceof Error ? cause.message : 'Không tải được báo cáo.'); }
    finally { setReportLoading(false); }
  }
  async function loadBookings() {
    if (!businessId) return;
    try {
      const q = queryString({ from: calendarDate, to: weekEnd, venueId: selectedVenueId || undefined });
      setBookings(await api<Row[]>('/owner/businesses/' + businessId + '/bookings?' + q));
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Không tải được lịch sân.'); }
  }

  async function loadBlocks() {
    if (!businessId || !selectedCourtId) { setBlocks([]); return; }
    try {
      const q = queryString({ from: calendarDate, to: weekEnd });
      setBlocks(await api<Row[]>('/owner/businesses/' + businessId + '/courts/' + selectedCourtId + '/blocks?' + q));
    } catch { setBlocks([]); }
  }

  useEffect(() => { if (!businessId && businesses[0]) setBusinessId(businesses[0].id); }, [businesses]);
  useEffect(() => { void loadVenues(); void loadStaff(); }, [businessId]);
  useEffect(() => { if (venue) setSelectedCourtId(venue.courts?.[0]?.id || ''); }, [selectedVenueId, venues.length]);
  useEffect(() => { void loadBookings(); }, [businessId, calendarDate, selectedVenueId]);
  useEffect(() => { void loadReport(); }, [businessId, manager, business?.status, reportFrom, reportTo]);
  useEffect(() => { void loadBlocks(); }, [businessId, calendarDate, selectedCourtId]);

  async function createVenue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!business) return;
    const data = new FormData(event.currentTarget);
    const sportCodes = sports.filter((item) => data.get('sport-' + item.code) === 'on').map((item) => item.code);
    const body: Row = {
      name: String(data.get('name') || '').trim(), address: String(data.get('address') || '').trim(),
      description: String(data.get('description') || '').trim(),
      sportCodes, mediaUrls: String(data.get('mediaUrls') || '').split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean),
    };
    const lat = String(data.get('latitude') || ''); const lng = String(data.get('longitude') || '');
    if (lat) body.latitude = Number(lat);
    if (lng) body.longitude = Number(lng);
    setBusy(true);
    try {
      const created = await api<Row>('/owner/businesses/' + business.id + '/venues', { method: 'POST', body: jsonBody(body) });
      notify('Địa điểm đã tạo. Cấu hình sân và giờ hoạt động để gửi duyệt.');
      await loadVenues();
      setSelectedVenueId(created.id);
      setCreateVenueOpen(false);
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Không tạo được địa điểm.'); }
    finally { setBusy(false); }
  }

  async function saveVenue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!business || !venue) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await api('/owner/businesses/' + business.id + '/venues/' + venue.id, {
        method: 'PATCH',
        body: jsonBody({
          name: String(data.get('name') || '').trim(), address: String(data.get('address') || '').trim(),
          description: String(data.get('description') || '').trim(),
          mediaUrls: String(data.get('mediaUrls') || '').split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean),
        }),
      });
      notify('Đã lưu thông tin địa điểm.');
      await loadVenues();
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Không lưu được địa điểm.'); }
    finally { setBusy(false); }
  }

  const [courtName, setCourtName] = useState('');
  const [courtType, setCourtType] = useState('');
  const [courtSport, setCourtSport] = useState('');
  const [opensAt, setOpensAt] = useState('07:00');
  const [closesAt, setClosesAt] = useState('23:00');
  const [price, setPrice] = useState('150000');
  const [defaultDuration, setDefaultDuration] = useState(60);
  const [minDuration, setMinDuration] = useState(60);
  const [maxDuration, setMaxDuration] = useState(120);
  const [slotInterval, setSlotInterval] = useState(30);

  useEffect(() => {
    if (!editingCourt) {
      setCourtName(''); setCourtType(''); setCourtSport(venue?.sport_codes?.[0] || sports.find((item) => item.active !== false)?.code || '');
      setOpensAt('07:00'); setClosesAt('23:00'); setPrice('150000');
      setDefaultDuration(60); setMinDuration(60); setMaxDuration(120); setSlotInterval(30);
      return;
    }
    const hours = editingCourt.operating_hours?.[0] || {};
    const pricing = editingCourt.price_rules?.[0] || {};
    setCourtName(editingCourt.name || ''); setCourtType(editingCourt.court_type || '');
    setCourtSport(editingCourt.sport_code || '');
    setOpensAt(String(hours.opensAt || '07:00').slice(0, 5)); setClosesAt(String(hours.closesAt || '23:00').slice(0, 5));
    setPrice(String(pricing.pricePerHour || '150000'));
    setDefaultDuration(Number(editingCourt.default_duration_minutes || 60));
    setMinDuration(Number(editingCourt.minimum_duration_minutes || 60));
    setMaxDuration(Number(editingCourt.maximum_duration_minutes || 120));
    setSlotInterval(Number(editingCourt.slot_interval_minutes || 30));
  }, [editingCourt, selectedVenueId]);

  async function saveCourt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!business || !venue) return;
    const schedule = Array.from({ length: 7 }, (_, weekday) => ({ weekday, opensAt, closesAt }));
    const pricing = Array.from({ length: 7 }, (_, weekday) => ({ weekday, startsAt: opensAt, endsAt: closesAt, pricePerHour: Number(price) }));
    const payload = { name: courtName, courtType: courtType || undefined, sportCode: courtSport, defaultDurationMinutes: defaultDuration, minimumDurationMinutes: minDuration, maximumDurationMinutes: maxDuration, slotIntervalMinutes: slotInterval, operatingHours: schedule, priceRules: pricing };
    setBusy(true);
    try {
      if (editingCourt) {
        await api('/owner/businesses/' + business.id + '/courts/' + editingCourt.id + '/configuration', { method: 'PATCH', body: jsonBody(payload) });
        notify('Đã cập nhật cấu hình sân.');
      } else {
        await api('/owner/businesses/' + business.id + '/venues/' + venue.id + '/courts', { method: 'POST', body: jsonBody(payload) });
        notify('Đã thêm sân vào địa điểm.');
      }
      setEditingCourt(null);
      await loadVenues();
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Không lưu được cấu hình sân.'); }
    finally { setBusy(false); }
  }

  async function submitVenue() {
    if (!business || !venue) return;
    setBusy(true);
    try { await api('/owner/businesses/' + business.id + '/venues/' + venue.id + '/submit', { method: 'POST' }); notify('Đã gửi địa điểm cho admin duyệt.'); await loadVenues(); }
    catch (cause) { notify(cause instanceof Error ? cause.message : 'Không gửi được địa điểm.'); }
    finally { setBusy(false); }
  }

  async function updateBooking(booking: Row, status: 'cancelled' | 'completed') {
    if (!business) return;
    const reason = status === 'cancelled' ? window.prompt('Lý do hủy lịch:') : '';
    if (status === 'cancelled' && reason === null) return;
    try {
      await api('/owner/businesses/' + business.id + '/bookings/' + booking.id, { method: 'PATCH', body: jsonBody({ status, reason: reason || undefined }) });
      notify(status === 'cancelled' ? 'Đã hủy lượt đặt.' : 'Đã đánh dấu hoàn tất.');
      await loadBookings();
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Không cập nhật được lượt đặt.'); }
  }

  async function manualBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!business || !selectedCourt) return;
    const data = new FormData(event.currentTarget);
    try {
      const payload = { courtId: selectedCourt.id, date: String(data.get('date')), startTime: String(data.get('startTime')), durationMinutes: Number(data.get('durationMinutes')), contactName: String(data.get('contactName')), contactPhone: String(data.get('contactPhone')), contactEmail: String(data.get('contactEmail') || '') || undefined };
      await api('/owner/businesses/' + business.id + '/bookings/manual', { method: 'POST', body: jsonBody(payload) });
      notify('Đã tạo lượt đặt thủ công.'); await loadBookings();
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Không tạo được lượt đặt.'); }
  }

  async function createBlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!business || !selectedCourt) return;
    const data = new FormData(event.currentTarget);
    const day = String(data.get('date')); const from = String(data.get('from')); const to = String(data.get('to'));
    try {
      await api('/owner/businesses/' + business.id + '/courts/' + selectedCourt.id + '/blocks', {
        method: 'POST',
        body: jsonBody({ startsAt: new Date(day + 'T' + from + ':00+07:00').toISOString(), endsAt: new Date(day + 'T' + to + ':00+07:00').toISOString(), reason: String(data.get('reason') || '') || undefined, source: String(data.get('source') || 'maintenance') }),
      });
      notify('Đã khóa khung giờ.'); await loadBlocks();
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Không khóa được khung giờ.'); }
  }

  async function deleteBlock(blockId: string) {
    if (!business) return;
    try { await api('/owner/businesses/' + business.id + '/blocks/' + blockId, { method: 'DELETE' }); notify('Đã mở lại khung giờ.'); await loadBlocks(); }
    catch (cause) { notify(cause instanceof Error ? cause.message : 'Không mở được khung giờ.'); }
  }

  async function assignStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!business || !venue) return;
    const data = new FormData(event.currentTarget);
    try { await api('/owner/businesses/' + business.id + '/staff', { method: 'POST', body: jsonBody({ venueId: venue.id, email: data.get('email'), venueRole: data.get('venueRole') }) }); notify('Đã phân công nhân viên.'); await loadStaff(); }
    catch (cause) { notify(cause instanceof Error ? cause.message : 'Không phân công được nhân viên.'); }
  }

  async function removeStaff(member: Row) {
    if (!business) return;
    try { await api('/owner/businesses/' + business.id + '/staff/' + member.venue_id + '/' + member.user_id, { method: 'DELETE' }); notify('Đã thu hồi quyền nhân viên.'); await loadStaff(); }
    catch (cause) { notify(cause instanceof Error ? cause.message : 'Không thu hồi được quyền.'); }
  }

  const reportStart = new Date(reportFrom + 'T12:00:00');
  const reportEnd = new Date(reportTo + 'T12:00:00');
  const reportDayCount = Math.max(0, Math.min(31, Math.floor((reportEnd.getTime() - reportStart.getTime()) / 86400000) + 1));
  const ownerDailyPoints: ChartPoint[] = Array.from({ length: reportDayCount }, (_, index) => {
    const day = addDays(reportFrom, index);
    const row = report?.daily?.find((item: Row) => String(item.booking_date).slice(0, 10) === day);
    return { label: new Date(day + 'T12:00:00').toLocaleDateString('vi-VN', { day: '2-digit', month: 'short' }), value: Number(row?.bookings_total) || 0 };
  });
  const ownerRevenuePoints: ChartPoint[] = Array.from({ length: reportDayCount }, (_, index) => {
    const day = addDays(reportFrom, index);
    const row = report?.daily?.find((item: Row) => String(item.booking_date).slice(0, 10) === day);
    return { label: new Date(day + 'T12:00:00').toLocaleDateString('vi-VN', { day: '2-digit', month: 'short' }), value: Number(row?.booked_value_vnd) || 0 };
  });
  const managedCourtCount = venues.reduce((count, item) => count + (Array.isArray(item.courts) ? item.courts.length : Number(item.court_count) || 0), 0);

  return <main className="page-wrap owner-wrap">
    <div className="page-title-row owner-page-heading"><div><span className="eyebrow">CỔNG CHỦ SÂN</span><h1>Vận hành địa điểm</h1><p>Tạo sân, mở lịch và theo dõi đặt chỗ trong một nơi.</p></div><span className="owner-role-pill"><span className="owner-role-dot"></span>{business ? (manager ? 'Quản lý doanh nghiệp' : 'Nhân viên địa điểm') : 'Không gian quản lý'}</span></div>
    {businesses.length > 1 && <label className="business-picker">Doanh nghiệp<select value={businessId} onChange={(event) => setBusinessId(event.target.value)}>{businesses.map((item) => <option key={item.id} value={item.id}>{item.display_name} · {statusText[item.status] || item.status}</option>)}</select></label>}
    {!business ? <Empty title="Chưa có hồ sơ chủ sân" detail="Đăng ký tài khoản chủ sân để tạo doanh nghiệp và địa điểm." /> : <>
      <div className="owner-status card"><div><span className="eyebrow">HỒ SƠ DOANH NGHIỆP</span><h2>{business.display_name}</h2>{business.review_reason && <p>{business.review_reason}</p>}</div><Badge value={business.status} /></div>
      {business.status !== 'approved' && <div className="callout"><AlertCircle size={18} /><div><strong>{business.status === 'pending_review' ? 'Hồ sơ đang được admin xem xét.' : business.status === 'rejected' ? 'Hồ sơ cần được cập nhật.' : 'Tài khoản chưa thể vận hành địa điểm.'}</strong><p>{business.status === 'pending_review' ? 'Bạn có thể theo dõi trạng thái tại đây. Sau khi được duyệt, hãy tạo địa điểm và cấu hình sân.' : business.review_reason || 'Hãy liên hệ admin để biết thêm thông tin.'}</p></div></div>}
      {manager && business.status === 'approved' && <>
        <div className="owner-summary-grid">
          <article className="card owner-summary-card"><span>ĐỊA ĐIỂM</span><strong>{venues.length}</strong><small>{venues.filter((item) => item.status === 'approved').length} địa điểm đang hoạt động</small></article>
          <article className="card owner-summary-card"><span>SÂN ĐANG QUẢN LÝ</span><strong>{managedCourtCount}</strong><small>{venue?.name || 'Tất cả địa điểm'}</small></article>
          <article className="card owner-summary-card"><span>LƯỢT ĐẶT TRONG KỲ</span><strong>{report ? Number(report.summary?.bookings_total) || 0 : '—'}</strong><small>{reportFrom} – {reportTo}</small></article>
          <article className="card owner-summary-card accent"><span>GIÁ TRỊ ĐẶT SÂN</span><strong>{report ? money(report.summary?.booked_value_vnd) : '—'}</strong><small>Đã xác nhận hoặc hoàn tất</small></article>
        </div>
        <div className="owner-dashboard-grid">
          <section className="card owner-chart-card owner-booking-chart">
            <div className="owner-chart-heading"><div><span className="eyebrow">HIỆU QUẢ VẬN HÀNH</span><h2>Lượt đặt theo ngày</h2><p>Số lượt đặt theo ngày trong khoảng đang chọn</p></div><span className="chart-period">Tối đa 31 ngày</span></div>
            <div className="owner-chart-date-filter"><label>Từ ngày<input type="date" value={reportFrom} max={reportTo} onChange={(event) => setReportFrom(event.target.value)} /></label><span>đến</span><label>Đến ngày<input type="date" value={reportTo} min={reportFrom} onChange={(event) => setReportTo(event.target.value)} /></label></div>
            {reportLoading ? <div className="chart-loading">Đang tải dữ liệu đặt sân…</div> : <BarChart points={ownerDailyPoints} ariaLabel="Biểu đồ lượt đặt sân theo ngày" valueFormatter={(value) => new Intl.NumberFormat('vi-VN').format(value) + ' lượt'} />}
            <div className="chart-footnote"><span><i className="chart-legend-dot" />Lượt đặt sân</span><span>{report?.summary ? `${report.summary.bookings_confirmed || 0} đã xác nhận · ${report.summary.bookings_completed || 0} hoàn tất` : 'Theo thời gian bắt đầu của lượt đặt'}</span></div>
          </section>
          <section className="card owner-chart-card owner-revenue-chart">
            <div className="owner-chart-heading"><div><span className="eyebrow">DOANH THU ĐẶT SÂN</span><h2>Giá trị theo ngày</h2></div><span className="chart-icon"><TrendingUp size={16} /></span></div>
            <strong className="owner-chart-total">{report ? money(report.summary?.booked_value_vnd) : '—'}</strong>
            <p className="owner-chart-caption">Tổng giá trị lượt đã xác nhận hoặc hoàn tất</p>
            {reportLoading ? <div className="chart-loading compact">Đang cập nhật biểu đồ…</div> : <AreaChart points={ownerRevenuePoints} ariaLabel="Biểu đồ giá trị đặt sân theo ngày" valueFormatter={money} />}
            <div className="chart-footnote"><span><i className="chart-legend-dot revenue" />Giá trị đặt sân</span><span>{report?.daily?.length || 0} ngày có giao dịch</span></div>
          </section>
        </div>
      </>}
      <div className="owner-layout">
        <section className="owner-main">
          <div className="section-heading"><div><span className="eyebrow">ĐỊA ĐIỂM CỦA BẠN</span><h2>{venues.length} địa điểm</h2></div><div className="inline-actions">{manager && business.status === 'approved' && venues.length > 0 && <button className="button primary small" onClick={() => setCreateVenueOpen(true)}>+ Thêm địa điểm</button>}<button className="button quiet small" onClick={() => void loadVenues()}><RotateCw size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} /> Làm mới</button></div></div>
          {venues.length > 0 && <div className="venue-selector">{venues.map((item) => <button key={item.id} className={'venue-select-card ' + (item.id === selectedVenueId ? 'active' : '')} onClick={() => { setSelectedVenueId(item.id); setEditingCourt(null); }}><span><strong>{item.name}</strong><small>{item.address}</small></span><Badge value={item.status} /></button>)}</div>}
          {(!venues.length || createVenueOpen) && <div className="card form-card"><span className="eyebrow">BƯỚC 1</span><h2>{venues.length ? 'Tạo địa điểm khác' : 'Tạo địa điểm đầu tiên'}</h2>{business.status === 'approved' && manager ? <form className="stack-form" onSubmit={createVenue}>
            <label>Tên địa điểm<input name="name" minLength={2} maxLength={160} required placeholder="Ví dụ: DatSan Sports Hub" /></label>
            <label>Địa chỉ<input name="address" minLength={5} maxLength={500} required placeholder="Số nhà, đường, phường, quận, tỉnh/thành" /></label>
            <label>Mô tả<textarea name="description" maxLength={5000} rows={3} placeholder="Mô tả tiện ích và đặc điểm sân" /></label>
            <div className="form-grid two"><label>Vĩ độ<input name="latitude" type="number" min="-90" max="90" step="any" placeholder="10.7769" /></label><label>Kinh độ<input name="longitude" type="number" min="-180" max="180" step="any" placeholder="106.7009" /></label></div>
            <fieldset className="sport-checks"><legend>Môn thể thao</legend>{sports.filter((item) => item.active !== false).map((item) => <label key={item.id}><input type="checkbox" name={'sport-' + item.code} />{item.name}</label>)}</fieldset>
            <label>Ảnh HTTPS <span className="optional">mỗi dòng một đường dẫn</span><textarea name="mediaUrls" rows={2} placeholder="https://..." /></label>
            <button className="button primary" disabled={busy}>{busy ? 'Đang tạo…' : 'Tạo địa điểm'}</button>
          </form> : <p className="muted">Doanh nghiệp cần được admin duyệt trước khi thêm địa điểm.</p>}</div>}
          {venue && <div className="owner-sections">
            <section className="card form-card">
              <div className="section-heading"><div><span className="eyebrow">THÔNG TIN ĐỊA ĐIỂM</span><h2>{venue.name}</h2></div><Badge value={venue.status} /></div>
              {manager && ['draft', 'rejected'].includes(venue.status) && <form className="stack-form" onSubmit={saveVenue}>
                <label>Tên địa điểm<input name="name" defaultValue={venue.name} required minLength={2} /></label>
                <label>Địa chỉ<input name="address" defaultValue={venue.address} required minLength={5} /></label>
                <label>Mô tả<textarea name="description" defaultValue={venue.description || ''} rows={3} /></label>
                <label>Ảnh HTTPS <span className="optional">mỗi dòng một đường dẫn</span><textarea name="mediaUrls" defaultValue={(venue.media_urls || []).join('\n')} rows={2} /></label>
                <div className="inline-actions"><button className="button outline small" disabled={busy}>Lưu thông tin</button>{['draft', 'rejected'].includes(venue.status) && <button type="button" className="button primary small" disabled={busy || !venue.courts?.length} onClick={() => void submitVenue()}>Gửi admin duyệt</button>}</div>
              </form>}
              {venue.review_reason && <p className="review-reason">Ghi chú admin: {venue.review_reason}</p>}
            </section>
            <section className="card form-card">
              <div className="section-heading"><div><span className="eyebrow">SÂN, GIỜ MỞ CỬA VÀ GIÁ</span><h2>{venue.courts?.length || 0} sân</h2></div>{manager && ['draft', 'rejected'].includes(venue.status) && <button className="button outline small" onClick={() => setEditingCourt(null)}>+ Thêm sân</button>}</div>
              {venue.courts?.length > 0 && <div className="court-admin-list">{venue.courts.map((item: Row) => <button className={'court-admin-row ' + (editingCourt?.id === item.id ? 'active' : '')} key={item.id} onClick={() => { setEditingCourt(item); setSelectedCourtId(item.id); }}><span className="court-symbol"><Building2 size={15} /></span><span><strong>{item.name}</strong><small>{item.sport_name} · {money(item.price_rules?.[0]?.pricePerHour)}/giờ</small></span><span className="text-button">Cấu hình <ArrowRight size={12} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: 2 }} /></span></button>)}</div>}
              {manager && ['draft', 'rejected'].includes(venue.status) && <form className="stack-form court-form" onSubmit={saveCourt}>
                <h3>{editingCourt ? 'Cập nhật cấu hình sân' : 'Cấu hình sân mới'}</h3>
                <div className="form-grid two"><label>Tên sân<input value={courtName} onChange={(event) => setCourtName(event.target.value)} required minLength={2} /></label><label>Loại sân <span className="optional">không bắt buộc</span><input value={courtType} onChange={(event) => setCourtType(event.target.value)} /></label>
                  <label>Môn<select value={courtSport} onChange={(event) => setCourtSport(event.target.value)} required>{(venue.sport_codes || []).map((code: string) => <option value={code} key={code}>{sports.find((item) => item.code === code)?.name || code}</option>)}</select></label>
                  <label>Giá / giờ<input type="number" min="0" step="1000" value={price} onChange={(event) => setPrice(event.target.value)} required /></label>
                  <label>Mở cửa<input type="time" value={opensAt} onChange={(event) => setOpensAt(event.target.value)} required /></label><label>Đóng cửa<input type="time" value={closesAt} onChange={(event) => setClosesAt(event.target.value)} required /></label>
                  <label>Thời lượng mặc định<select value={defaultDuration} onChange={(event) => setDefaultDuration(Number(event.target.value))}>{[30, 60, 90, 120, 150, 180].map((value) => <option value={value} key={value}>{value} phút</option>)}</select></label>
                  <label>Khoảng đặt sân<select value={slotInterval} onChange={(event) => setSlotInterval(Number(event.target.value))}>{[15, 30, 60].map((value) => <option value={value} key={value}>{value} phút</option>)}</select></label>
                  <label>Tối thiểu (phút)<input type="number" min="15" step={slotInterval} value={minDuration} onChange={(event) => setMinDuration(Number(event.target.value))} /></label><label>Tối đa (phút)<input type="number" min="15" step={slotInterval} value={maxDuration} onChange={(event) => setMaxDuration(Number(event.target.value))} /></label>
                </div>
                <div className="inline-actions"><button className="button primary small" disabled={busy}>{busy ? 'Đang lưu…' : editingCourt ? 'Lưu cấu hình sân' : 'Thêm sân'}</button>{editingCourt && <button type="button" className="button quiet small" onClick={() => setEditingCourt(null)}>Hủy chỉnh sửa</button>}</div>
              </form>}
            </section>
          </div>}
        </section>
        <aside className="owner-aside">
          <section className="card calendar-card"><span className="eyebrow">LỊCH 7 NGÀY</span><h2>Lịch đặt sân</h2><label>Tuần bắt đầu<input type="date" value={calendarDate} onChange={(event) => setCalendarDate(event.target.value)} /></label><div className="calendar-week">{Array.from({ length: 7 }, (_, index) => {
            const day = addDays(calendarDate, index);
            const items = bookings.filter((booking) => String(booking.start_at).slice(0, 10) === day);
            return <div className="calendar-day" key={day}><div><span>{new Date(day + 'T12:00:00').toLocaleDateString('vi-VN', { weekday: 'short' })}</span><strong>{day.slice(8)}</strong></div><span className="day-count">{items.length}</span></div>;
          })}</div>
            <div className="section-heading calendar-list-heading"><h3>Đặt chỗ trong tuần</h3><span>{bookings.length}</span></div>
            {bookings.length ? <div className="owner-bookings">{bookings.map((item) => <article className="owner-booking" key={item.id}><div><strong>{new Date(item.start_at).toLocaleString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</strong><span>{item.venue_name} · {item.court_name}</span><small>{item.contact_name} · {money(item.total_price)}</small></div><div className="owner-booking-actions"><Badge value={item.status} />{item.status === 'confirmed' && <button className="text-button" onClick={() => void updateBooking(item, 'completed')}>Hoàn tất</button>}{['confirmed', 'pending_payment'].includes(item.status) && <button className="text-button danger-text" onClick={() => void updateBooking(item, 'cancelled')}>Hủy</button>}</div></article>)}</div> : <p className="muted small-copy">Chưa có lượt đặt trong khoảng ngày này.</p>}
          </section>
          {selectedCourt && business.status === 'approved' && <section className="card calendar-card"><span className="eyebrow">THAO TÁC LỊCH</span><h2>{selectedCourt.name}</h2><details><summary>Tạo đặt chỗ tại quầy</summary><form className="stack-form compact-form" onSubmit={manualBooking}><label>Ngày<input name="date" type="date" min={today()} defaultValue={calendarDate} required /></label><div className="form-grid two"><label>Giờ<input name="startTime" type="time" required /></label><label>Thời lượng<select name="durationMinutes" defaultValue={selectedCourt.default_duration_minutes || 60}>{Array.from({ length: Math.floor((Number(selectedCourt.maximum_duration_minutes || 120) - Number(selectedCourt.minimum_duration_minutes || 30)) / Number(selectedCourt.slot_interval_minutes || 30)) + 1 }, (_, index) => Number(selectedCourt.minimum_duration_minutes || 30) + index * Number(selectedCourt.slot_interval_minutes || 30)).map((minutes) => <option value={minutes} key={minutes}>{minutes} phút</option>)}</select></label></div><label>Tên khách<input name="contactName" minLength={2} required /></label><label>Số điện thoại<input name="contactPhone" type="tel" minLength={6} required /></label><label>Email<input name="contactEmail" type="email" /></label><button className="button primary small">Tạo đặt chỗ</button></form></details>
            <details><summary>Khóa khung giờ</summary><form className="stack-form compact-form" onSubmit={createBlock}><label>Ngày<input name="date" type="date" min={today()} defaultValue={calendarDate} required /></label><div className="form-grid two"><label>Từ<input name="from" type="time" required /></label><label>Đến<input name="to" type="time" required /></label></div><label>Lý do<input name="reason" maxLength={500} placeholder="Bảo trì, sự kiện..." /></label><label>Loại khóa<select name="source"><option value="maintenance">Bảo trì</option><option value="event">Sự kiện</option><option value="external_booking">Đặt ngoài hệ thống</option></select></label><button className="button outline small">Khóa giờ</button></form></details>
            {blocks.length > 0 && <div className="block-list">{blocks.map((block) => <div key={block.id}><span><strong>{dateLabel(block.starts_at, { hour: '2-digit', minute: '2-digit' })}</strong><small>{block.reason || statusText[block.source] || block.source}</small></span><button className="text-button danger-text" onClick={() => void deleteBlock(block.id)}>Mở lại</button></div>)}</div>}
          </section>}
          {manager && venue && business.status === 'approved' && <section className="card calendar-card"><span className="eyebrow">PHÂN CÔNG</span><h2>Nhân viên địa điểm</h2><form className="stack-form compact-form" onSubmit={assignStaff}><label>Email tài khoản đã đăng ký<input name="email" type="email" required placeholder="nhanvien@email.com" /></label><label>Quyền<select name="venueRole"><option value="staff">Nhân viên</option><option value="manager">Quản lý lịch</option></select></label><button className="button outline small">Phân công tại {venue.name}</button></form>{staff.length > 0 && <div className="staff-list">{staff.map((member) => <div key={member.user_id + member.venue_id}><span>{member.full_name || member.email}<small>{member.venue_name} · {member.venue_role}</small></span><button className="text-button danger-text" onClick={() => void removeStaff(member)}>Thu hồi</button></div>)}</div>}</section>}
        </aside>
      </div>
    </>}
  </main>;
}

export function AdminPanel({ notify }: { notify: (message: string) => void }) {
  const [tab, setTab] = useState<'overview' | 'businesses' | 'venues' | 'sports' | 'users' | 'reports' | 'audit'>('overview');
  const [dashboard, setDashboard] = useState<Row>({});
  const [businesses, setBusinesses] = useState<Row[]>([]);
  const [venues, setVenues] = useState<Row[]>([]);
  const [sports, setSports] = useState<Sport[]>([]);
  const [users, setUsers] = useState<Row[]>([]);
  const [reports, setReports] = useState<Row[]>([]);
  const [audit, setAudit] = useState<Row[]>([]);
  const [userQuery, setUserQuery] = useState('');

  async function loadAll() {
    try {
      const [stats, businessRows, venueRows, sportRows, reportRows, auditRows] = await Promise.all([
        api<Row>('/admin/dashboard'), api<Row[]>('/admin/businesses'), api<Row[]>('/admin/venues'),
        api<Sport[]>('/admin/sports'), api<Row[]>('/admin/community/reports?status=pending'), api<Row[]>('/admin/audit-log'),
      ]);
      setDashboard(stats); setBusinesses(businessRows); setVenues(venueRows); setSports(sportRows); setReports(reportRows); setAudit(auditRows);
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Không tải được dữ liệu admin.'); }
  }

  useEffect(() => { void loadAll(); }, []);

  async function review(type: 'businesses' | 'venues', item: Row, outcome: 'approved' | 'rejected' | 'suspended') {
    const reason = outcome === 'approved' ? undefined : window.prompt(outcome === 'rejected' ? 'Lý do cần bổ sung:' : 'Lý do tạm khóa:');
    if (outcome !== 'approved' && !reason?.trim()) return;
    try {
      await api('/admin/' + type + '/' + item.id + '/review', { method: 'PATCH', body: jsonBody({ outcome, reason }) });
      notify(outcome === 'approved' ? 'Đã duyệt hồ sơ.' : outcome === 'rejected' ? 'Đã trả hồ sơ để bổ sung.' : 'Đã tạm khóa.');
      await loadAll();
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Không cập nhật được hồ sơ.'); }
  }

  async function searchUsers(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    try { setUsers(await api<Row[]>('/admin/users' + (userQuery ? '?q=' + encodeURIComponent(userQuery) : ''))); }
    catch (cause) { notify(cause instanceof Error ? cause.message : 'Không tìm được tài khoản.'); }
  }

  async function toggleUser(user: Row) {
    try { await api('/admin/users/' + user.id + '/active', { method: 'PATCH', body: jsonBody({ active: !user.active }) }); notify(user.active ? 'Đã khóa tài khoản.' : 'Đã mở khóa tài khoản.'); await searchUsers(); }
    catch (cause) { notify(cause instanceof Error ? cause.message : 'Không đổi được trạng thái tài khoản.'); }
  }

  async function addSport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try { await api('/admin/sports', { method: 'POST', body: jsonBody({ code: String(data.get('code')).trim().toLowerCase(), name: String(data.get('name')).trim() }) }); notify('Đã thêm môn thể thao.'); await loadAll(); }
    catch (cause) { notify(cause instanceof Error ? cause.message : 'Không thêm được môn thể thao.'); }
  }

  async function toggleSport(sport: Sport) {
    try { await api('/admin/sports/' + sport.id, { method: 'PATCH', body: jsonBody({ active: !sport.active }) }); notify(sport.active ? 'Đã ẩn môn thể thao.' : 'Đã bật môn thể thao.'); await loadAll(); }
    catch (cause) { notify(cause instanceof Error ? cause.message : 'Không cập nhật được môn thể thao.'); }
  }

  async function resolveReport(report: Row, outcome: 'resolved' | 'dismissed') {
    const resolutionNote = window.prompt('Ghi chú xử lý (không bắt buộc):') || undefined;
    try { await api('/admin/community/reports/' + report.id + '/review', { method: 'PATCH', body: jsonBody({ outcome, resolutionNote }) }); notify('Đã xử lý báo cáo.'); await loadAll(); }
    catch (cause) { notify(cause instanceof Error ? cause.message : 'Không xử lý được báo cáo.'); }
  }

  const tabs: Array<[typeof tab, string]> = [['overview', 'Tổng quan'], ['businesses', 'Chủ sân'], ['venues', 'Địa điểm'], ['sports', 'Môn thể thao'], ['users', 'Tài khoản'], ['reports', 'Báo cáo'], ['audit', 'Nhật ký']];
  const tabIcons: Record<typeof tab, ReactNode> = {
    overview: <LayoutDashboard size={15} />,
    businesses: <Building2 size={15} />,
    venues: <MapPin size={15} />,
    sports: <Activity size={15} />,
    users: <User size={15} />,
    reports: <Flag size={15} />,
    audit: <ScrollText size={15} />,
  };
  const adminBookingPoints: ChartPoint[] = (dashboard.booking_trend || []).map((item: Row) => {
    const month = String(item.month || '');
    const date = new Date(month + '-01T12:00:00');
    return { label: Number.isNaN(date.getTime()) ? month : new Intl.DateTimeFormat('vi-VN', { month: 'short' }).format(date).replace('.', ''), value: Number(item.bookings_total) || 0 };
  });
  const adminRevenuePoints: ChartPoint[] = (dashboard.booking_trend || []).map((item: Row) => {
    const month = String(item.month || '');
    const date = new Date(month + '-01T12:00:00');
    return { label: Number.isNaN(date.getTime()) ? month : new Intl.DateTimeFormat('vi-VN', { month: 'short' }).format(date).replace('.', ''), value: Number(item.booked_value_vnd) || 0 };
  });
  return <main className="page-wrap admin-wrap">
    <div className="admin-page-heading"><div><span className="eyebrow">QUẢN TRỊ NỀN TẢNG</span><h1>Điều hành DatSan</h1><p>Duyệt nội dung, theo dõi hoạt động và quản lý danh mục.</p></div><button className="button outline small" onClick={() => void loadAll()}><RotateCw size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} /> Làm mới dữ liệu</button></div>
    <div className="admin-workspace">
    <nav className="admin-sidebar" aria-label="Điều hướng quản trị">{tabs.map(([key, label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}><span className="admin-nav-icon">{tabIcons[key]}</span><span>{label}</span>{key === 'businesses' && businesses.filter((item) => item.status === 'pending_review').length > 0 && <span className="tab-count">{businesses.filter((item) => item.status === 'pending_review').length}</span>}{key === 'venues' && venues.filter((item) => item.status === 'pending_review').length > 0 && <span className="tab-count">{venues.filter((item) => item.status === 'pending_review').length}</span>}</button>)}</nav>
    <div className="admin-content">
    {tab === 'overview' && <>
      <div className="stat-grid">{[
        ['Doanh nghiệp', dashboard.businesses_total ?? 0, (dashboard.businesses_pending ?? 0) + ' chờ duyệt'],
        ['Địa điểm', dashboard.venues_total ?? 0, (dashboard.venues_pending ?? 0) + ' chờ duyệt'],
        ['Lượt đặt', dashboard.bookings_total ?? 0, (dashboard.bookings_confirmed ?? 0) + ' đã xác nhận'],
        ['Giá trị đặt sân', money(dashboard.booked_value_vnd), money(dashboard.demo_paid_vnd) + ' demo đã thu'],
      ].map(([label, value, detail]) => <article className="card stat-card" key={String(label)}><span>{label}</span><strong>{value ?? '—'}</strong><small>{detail ?? ''}</small></article>)}</div>
      <div className="admin-chart-grid">
        <section className="card admin-chart-card admin-booking-chart"><div className="admin-chart-heading"><div><span className="eyebrow">HOẠT ĐỘNG NỀN TẢNG</span><h2>Lượt đặt mới</h2><p>Thống kê sáu tháng gần nhất</p></div><strong className="chart-head-stat">{dashboard.bookings_total ?? 0}<small>tất cả lượt</small></strong></div><BarChart points={adminBookingPoints} ariaLabel="Biểu đồ lượt đặt mới sáu tháng gần nhất" valueFormatter={(value) => new Intl.NumberFormat('vi-VN').format(value) + ' lượt'} /><div className="chart-footnote"><span><i className="chart-legend-dot" />Lượt đặt được tạo</span><span>Tháng gần nhất được tô đậm</span></div></section>
        <section className="card admin-chart-card admin-revenue-chart"><div className="admin-chart-heading"><div><span className="eyebrow">GIÁ TRỊ GIAO DỊCH</span><h2>Giá trị đặt sân</h2></div><span className="chart-icon"><TrendingUp size={16} /></span></div><strong className="admin-chart-total">{money(dashboard.booked_value_vnd)}</strong><p className="admin-chart-caption">Tổng giá trị các lượt đã xác nhận hoặc hoàn tất</p><AreaChart points={adminRevenuePoints} ariaLabel="Biểu đồ giá trị đặt sân sáu tháng gần nhất" valueFormatter={money} /><div className="chart-footnote"><span><i className="chart-legend-dot revenue" />Giá trị đặt sân</span><span>6 tháng</span></div></section>
      </div>
      <div className="admin-overview-grid">
        <section className="card admin-overview-card admin-status-card"><div className="section-heading"><div><span className="eyebrow">TÌNH TRẠNG HỒ SƠ</span><h2>Tiến độ kiểm duyệt</h2></div></div><StatusBreakdown label="Chủ sân" total={Number(dashboard.businesses_total) || 0} approved={Number(dashboard.businesses_approved) || 0} pending={Number(dashboard.businesses_pending) || 0} /><StatusBreakdown label="Địa điểm" total={Number(dashboard.venues_total) || 0} approved={Number(dashboard.venues_approved) || 0} pending={Number(dashboard.venues_pending) || 0} /></section>
        <section className="card admin-overview-card admin-queue-card"><div className="section-heading"><div><span className="eyebrow">CẦN XỬ LÝ</span><h2>Hồ sơ chờ duyệt</h2></div></div><div className="queue-row"><span>Chủ sân</span><strong>{businesses.filter((item) => item.status === 'pending_review').length}</strong><button className="text-button" onClick={() => setTab('businesses')}>Mở danh sách <ArrowRight size={12} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: 2 }} /></button></div><div className="queue-row"><span>Địa điểm</span><strong>{venues.filter((item) => item.status === 'pending_review').length}</strong><button className="text-button" onClick={() => setTab('venues')}>Mở danh sách <ArrowRight size={12} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: 2 }} /></button></div><div className="queue-row"><span>Báo cáo cộng đồng</span><strong>{reports.length}</strong><button className="text-button" onClick={() => setTab('reports')}>Mở danh sách <ArrowRight size={12} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: 2 }} /></button></div></section>
        <section className="admin-note"><span className="eyebrow">NHẬT KÝ QUẢN TRỊ</span><h2>Mỗi quyết định đều có dấu vết.</h2><p>Các thao tác duyệt, khóa tài khoản và xử lý báo cáo đều được ghi lại.</p><button className="button outline small" onClick={() => setTab('audit')}>Mở nhật ký <ArrowRight size={12} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: 4 }} /></button></section>
      </div>
    </>}
    {tab === 'businesses' && <section className="admin-table-section"><div className="section-heading"><div><span className="eyebrow">HỒ SƠ KINH DOANH</span><h2>{businesses.length} doanh nghiệp</h2></div><label className="compact-select"><select onChange={async (event) => { const value = event.target.value; try { setBusinesses(await api<Row[]>('/admin/businesses' + (value ? '?status=' + value : ''))); } catch { /* global notice */ } }}><option value="">Tất cả trạng thái</option><option value="pending_review">Chờ duyệt</option><option value="approved">Đã duyệt</option><option value="rejected">Cần bổ sung</option><option value="suspended">Tạm khóa</option></select></label></div>{businesses.length ? <div className="admin-rows">{businesses.map((item) => <article className="card admin-row" key={item.id}><div className="admin-row-main"><div className="admin-item-icon"><Building2 size={16} /></div><div><div className="admin-row-title"><h3>{item.display_name}</h3><Badge value={item.status} /></div><p>{item.owner_name || 'Chưa có tên'} · {item.owner_email || 'Chưa có email'}</p>{item.review_reason && <small className="review-reason">{item.review_reason}</small>}<small>{dateLabel(item.created_at)}</small></div></div><div className="inline-actions">{item.status === 'pending_review' && <><button className="button primary small" onClick={() => void review('businesses', item, 'approved')}>Duyệt</button><button className="button outline small" onClick={() => void review('businesses', item, 'rejected')}>Yêu cầu bổ sung</button></>}{item.status === 'approved' && <button className="button danger small" onClick={() => void review('businesses', item, 'suspended')}>Tạm khóa</button>}{item.status === 'suspended' && <button className="button outline small" onClick={() => void review('businesses', item, 'approved')}>Mở lại</button>}</div></article>)}</div> : <Empty title="Chưa có hồ sơ chủ sân" detail="Hồ sơ mới sẽ xuất hiện tại đây khi chủ sân gửi đăng ký." />}</section>}
    {tab === 'venues' && <section className="admin-table-section"><div className="section-heading"><div><span className="eyebrow">ĐỊA ĐIỂM</span><h2>{venues.length} địa điểm</h2></div><label className="compact-select"><select onChange={async (event) => { const value = event.target.value; try { setVenues(await api<Row[]>('/admin/venues' + (value ? '?status=' + value : ''))); } catch {} }}><option value="">Tất cả trạng thái</option><option value="pending_review">Chờ duyệt</option><option value="approved">Đã duyệt</option><option value="rejected">Cần bổ sung</option><option value="suspended">Tạm khóa</option></select></label></div>{venues.length ? <div className="admin-rows">{venues.map((item) => <article className="card admin-row" key={item.id}><div className="admin-row-main"><div className="admin-item-icon green"><MapPin size={16} /></div><div><div className="admin-row-title"><h3>{item.name}</h3><Badge value={item.status} /></div><p>{item.business_name} · {item.court_count} sân</p><p>{item.address}</p>{item.review_reason && <small className="review-reason">{item.review_reason}</small>}</div></div><div className="inline-actions">{item.status === 'pending_review' && <><button className="button primary small" onClick={() => void review('venues', item, 'approved')}>Duyệt</button><button className="button outline small" onClick={() => void review('venues', item, 'rejected')}>Yêu cầu bổ sung</button></>}{item.status === 'approved' && <button className="button danger small" onClick={() => void review('venues', item, 'suspended')}>Tạm khóa</button>}{item.status === 'suspended' && <button className="button outline small" onClick={() => void review('venues', item, 'approved')}>Mở lại</button>}</div></article>)}</div> : <Empty title="Chưa có địa điểm" detail="Địa điểm sẽ xuất hiện sau khi chủ sân gửi cấu hình lên duyệt." />}</section>}
    {tab === 'sports' && <div className="admin-two-col"><section className="card form-card"><span className="eyebrow">DANH MỤC</span><h2>Môn thể thao</h2><div className="sport-admin-list">{sports.map((item) => <div className="sport-admin-row" key={item.id}><span className="sport-glyph">{item.name.slice(0, 1)}</span><span><strong>{item.name}</strong><small>{item.code}</small></span><button className={'toggle ' + (item.active ? 'on' : '')} onClick={() => void toggleSport(item)} aria-label="Bật tắt môn"></button></div>)}</div></section><section className="card form-card"><span className="eyebrow">MỞ RỘNG NỀN TẢNG</span><h2>Thêm môn thể thao</h2><p className="muted">Mã môn dùng chữ thường, số, gạch ngang hoặc gạch dưới.</p><form className="stack-form" onSubmit={addSport}><label>Mã môn<input name="code" required pattern="[a-z0-9_-]+" maxLength={80} placeholder="volleyball" /></label><label>Tên hiển thị<input name="name" required minLength={2} maxLength={120} placeholder="Bóng chuyền" /></label><button className="button primary">Thêm môn</button></form></section></div>}
    {tab === 'users' && <section className="admin-table-section"><div className="section-heading"><div><span className="eyebrow">TÀI KHOẢN</span><h2>Tra cứu người dùng</h2></div></div><form className="admin-search" onSubmit={(event) => void searchUsers(event)}><input value={userQuery} onChange={(event) => setUserQuery(event.target.value)} placeholder="Tìm theo tên, email hoặc số điện thoại" /><button className="button primary small">Tìm kiếm</button></form>{users.length ? <div className="admin-rows">{users.map((item) => <article className="card admin-row compact-row" key={item.id}><div className="admin-row-main"><div className="avatar big">{(item.full_name || item.email || 'U').slice(0, 1).toUpperCase()}</div><div><h3>{item.full_name || 'Chưa cập nhật tên'}</h3><p>{item.email || 'Tài khoản Zalo'} · {item.phone || 'Chưa có số điện thoại'}</p><small>{item.platform_role === 'platform_admin' ? 'Admin nền tảng' : 'Khách hàng'} · {item.active ? 'Đang hoạt động' : 'Đã khóa'}</small></div></div><button className={'button small ' + (item.active ? 'danger' : 'outline')} onClick={() => void toggleUser(item)}>{item.active ? 'Khóa tài khoản' : 'Mở khóa'}</button></article>)}</div> : <Empty title={userQuery ? 'Không tìm thấy tài khoản' : 'Nhập thông tin để tra cứu'} detail={userQuery ? 'Thử tìm bằng tên, email hoặc số điện thoại khác.' : 'Kết quả tra cứu tài khoản sẽ hiển thị ở đây.'} />}</section>}
    {tab === 'reports' && <section className="admin-table-section"><div className="section-heading"><div><span className="eyebrow">AN TOÀN CỘNG ĐỒNG</span><h2>{reports.length} báo cáo chờ xử lý</h2></div></div>{reports.length ? <div className="admin-rows">{reports.map((item) => <article className="card admin-row" key={item.id}><div className="admin-row-main"><div className="admin-item-icon"><Flag size={16} /></div><div><div className="admin-row-title"><h3>Báo cáo bài ghép kèo</h3><Badge value={item.status} /></div><p>{item.reporter_name} · Kèo bắt đầu {dateLabel(item.starts_at)}</p><p>{item.reason}</p><small>Mã bài: {item.game_id}</small></div></div><div className="inline-actions"><button className="button primary small" onClick={() => void resolveReport(item, 'resolved')}>Gỡ nội dung</button><button className="button outline small" onClick={() => void resolveReport(item, 'dismissed')}>Bỏ qua</button></div></article>)}</div> : <Empty title="Không có báo cáo chờ xử lý" detail="Các báo cáo mới sẽ xuất hiện tại đây." />}</section>}
    {tab === 'audit' && <section className="admin-table-section"><div className="section-heading"><div><span className="eyebrow">LỊCH SỬ THAO TÁC</span><h2>{audit.length} sự kiện gần đây</h2></div></div>{audit.length ? <div className="audit-list">{audit.map((item) => <article className="audit-row" key={item.id}><span className="audit-dot"></span><div><strong>{item.action}</strong><p>{item.actor_name || item.actor_email || 'Tài khoản đã xóa'} · {item.entity_type} · {item.entity_id}</p><small>{dateLabel(item.created_at, { hour: '2-digit', minute: '2-digit' })}</small></div><code>{JSON.stringify(item.details || {})}</code></article>)}</div> : <Empty title="Chưa có thao tác quản trị" />}</section>}
    </div></div>
  </main>;
}

export default function App() {
  const [page, setPage] = useState<View>('discover');
  const [authMode, setAuthMode] = useState<'login' | 'customer' | 'business'>('login');
  const [authReturnView, setAuthReturnView] = useState<View>('discover');
  const [user, setUser] = useState<User | null>(null);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [sports, setSports] = useState<Sport[]>([]);
  const [notice, setNotice] = useState('');
  const [venues, setVenues] = useState<Row[]>([]);

  useEffect(() => {
    void initZaloHeader();
    api<Sport[]>('/sports').then(setSports).catch((cause) => setNotice(cause instanceof Error ? cause.message : 'Không kết nối được API.'));
    api<Row[]>('/venues').then(setVenues).catch(() => setVenues([]));
    if (getAccessToken()) {
      api<User>('/auth/me').then((restoredUser) => {
        setUser(restoredUser);
        if (restoredUser.platformRole === 'platform_admin') {
          setPage('admin');
        }
      }).catch(() => setAccessToken(null));
    }
  }, []);

  useEffect(() => {
    if (!user) { setBusinesses([]); return; }
    api<Business[]>('/owner/businesses').then(setBusinesses).catch(() => setBusinesses([]));
  }, [user?.id]);

  useEffect(() => {
    const handle = (event: Event) => {
      const view = (event as CustomEvent<View>).detail;
      if (view) setPage(view);
    };
    window.addEventListener('datsan:navigate', handle);
    return () => window.removeEventListener('datsan:navigate', handle);
  }, []);

  function loginSuccess(result: Row) {
    setAccessToken(result.accessToken);
    setUser(result.user);
    if (result.user?.platformRole === 'platform_admin') {
      setPage('admin');
      setNotice('Xin chào Quản trị viên!');
      return;
    }
    setPage(result.business ? 'owner' : authReturnView);
    setNotice(result.business?.status === 'pending_review' ? 'Hồ sơ chủ sân đã gửi và đang chờ admin duyệt.' : 'Đăng nhập thành công.');
  }

  function signOut() {
    setAccessToken(null);
    setUser(null);
    setBusinesses([]);
    setPage('discover');
    setNotice('Bạn đã đăng xuất.');
  }

  function notify(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice((current) => current === message ? '' : current), 4800);
  }

  let content: ReactNode;
  if (page === 'admin' && user?.platformRole === 'platform_admin') content = <AdminPanel notify={notify} />;
  else if (page === 'account') content = user ? <BookingPanel user={user} onUserUpdated={setUser} notify={notify} /> : <AuthPanel onSuccess={loginSuccess} initialMode={authMode} />;
  else if (page === 'community') content = <CommunityPanel sports={sports} user={user} onLogin={() => { setAuthMode('login'); setAuthReturnView('community'); setPage('account'); }} notify={notify} />;
  else if (page === 'bookings' && user) content = <BookingPanel user={user} onUserUpdated={setUser} notify={notify} />;
  else if (page === 'owner' && user && businesses.length) content = <OwnerPanel businesses={businesses} sports={sports} notify={notify} />;
  else content = <ExplorePanel sports={sports} user={user} onLogin={() => { setAuthMode('login'); setAuthReturnView('discover'); setPage('account'); }} onOpenBookings={() => setPage('bookings')} notify={notify} />;

  return <div className="app-shell">
    <Header page={page} setPage={setPage} user={user} businesses={businesses} onSignOut={signOut} onAccount={(mode) => { setAuthMode(mode); setAuthReturnView('discover'); setPage('account'); }} />
    {notice && <div className="toast" role="status"><Sparkles size={16} className="toast-sparkle" /><span>{notice}</span><button aria-label="Đóng" onClick={() => setNotice('')}><X size={14} /></button></div>}
    {content}
    <footer className="site-footer"><div className="footer-brand"><span className="brand-icon">D</span><span>DatSan<small>CHƠI THỂ THAO CÙNG NHAU</small></span></div><span>© {new Date().getFullYear()} DatSan</span><span>Tìm sân · Tạo trận · Vào cuộc</span></footer>
    <nav className="mobile-nav-spacer" aria-hidden="true"></nav>
  </div>;
}
