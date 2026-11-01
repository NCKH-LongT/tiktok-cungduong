'use client';
import { useEffect, useRef, useState } from 'react';

type User = { id: string; email: string; role: string };
type Live = { id: string; title: string; uniqueId: string; status: string };
type Billing = { active: boolean; adminFree: boolean; paymentAvailable: boolean; accessUntil: string | null; priceVnd: number; durationHours: number; pendingCheckoutUrl: string | null };

async function api(path: string, init?: RequestInit) {
  const response = await fetch('/api' + path, { ...init, credentials: 'include', headers: { 'content-type': 'application/json', ...init?.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Request failed');
  return data;
}

type Turnstile = { render: (element: HTMLElement, options: Record<string, unknown>) => string; remove: (id: string) => void; reset: (id: string) => void };
function TurnstileWidget({ siteKey, onToken, resetSignal }: { siteKey: string; onToken: (token: string) => void; resetSignal: number }) {
  const holder = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  useEffect(() => {
    const win = window as typeof window & { turnstile?: Turnstile };
    let active = true;
    const reset = () => { onToken(''); if (widgetId.current) win.turnstile?.reset(widgetId.current); };
    const render = () => { if (active && holder.current && win.turnstile && !widgetId.current) widgetId.current = win.turnstile.render(holder.current, { sitekey: siteKey, callback: onToken, 'expired-callback': reset, 'timeout-callback': reset, 'error-callback': () => onToken('') }); };
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = render;
    document.head.appendChild(script);
    render();
    return () => { active = false; if (widgetId.current) win.turnstile?.remove(widgetId.current); widgetId.current = null; script.remove(); };
  }, [siteKey, onToken]);
  useEffect(() => {
    if (resetSignal > 0 && widgetId.current) {
      onToken('');
      (window as typeof window & { turnstile?: Turnstile }).turnstile?.reset(widgetId.current);
    }
  }, [resetSignal, onToken]);
  return <div ref={holder} aria-label="Cloudflare Turnstile" />;
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [billing, setBilling] = useState<Billing | null>(null);
  const [lives, setLives] = useState<Live[]>([]);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [captcha, setCaptcha] = useState('');
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0);
  const [signingIn, setSigningIn] = useState(false);
  const signingInRef = useRef(false);
  const [siteKey, setSiteKey] = useState('');
  const [title, setTitle] = useState('');
  const [uniqueId, setUniqueId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [deletingLiveId, setDeletingLiveId] = useState<string | null>(null);

  async function reload() {
    try {
      const me = await api('/auth/me') as User;
      setUser(me);
      const status = await api('/billing/status') as Billing;
      setBilling(status);
      setLives(await api('/lives') as Live[]);
      if (status.active && window.location.search.includes('payment=')) window.history.replaceState(null, '', '/');
    } catch (cause) {
      if (String(cause).includes('Authentication required') || String(cause).includes('Session expired')) {
        setUser(null); setBilling(null); setLives([]);
      } else setError(String(cause));
    } finally { setLoading(false); }
  }

  useEffect(() => {
    void reload();
    void api('/public-config').then(data => setSiteKey(data.turnstileSiteKey ?? '')).catch(() => {});
    const refresh = () => { if (document.visibilityState === 'visible') void reload(); };
    document.addEventListener('visibilitychange', refresh);
    const returning = window.location.search.includes('payment=');
    let count = 0;
    const timer = returning ? window.setInterval(() => { if (++count <= 20) void reload(); }, 3000) : undefined;
    return () => { document.removeEventListener('visibilitychange', refresh); if (timer) clearInterval(timer); };
  }, []);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    if (signingInRef.current) return;
    signingInRef.current = true; setSigningIn(true); setError('');
    try {
      await api('/auth/login', { method: 'POST', body: JSON.stringify({ login, password, turnstileToken: captcha }) });
      setPassword(''); await reload();
    } catch (cause) { setError(String(cause)); setCaptcha(''); setTurnstileResetSignal(value => value + 1); }
    finally { signingInRef.current = false; setSigningIn(false); }
  }
  async function add(event: React.FormEvent) {
    event.preventDefault(); setError('');
    try {
      await api('/lives', { method: 'POST', body: JSON.stringify({ title, uniqueId }) });
      setTitle(''); setUniqueId(''); await reload();
    } catch (cause) { setError(String(cause)); }
  }
  async function removeLive(live: Live) {
    if (!window.confirm(`Xóa vĩnh viễn TikTok ID @${live.uniqueId}? Toàn bộ bình luận, quà tặng, lịch sử AI, token overlay và âm thanh đang chờ của LIVE này sẽ bị xóa.`)) return;
    setDeletingLiveId(live.id); setError('');
    try {
      await api(`/lives/${live.id}`, { method: 'DELETE' });
      setLives(current => current.filter(item => item.id !== live.id));
    } catch (cause) { setError(String(cause)); }
    finally { setDeletingLiveId(null); }
  }
  async function checkout() {
    setError(''); setCheckoutBusy(true);
    try {
      const result = await api('/billing/checkout', { method: 'POST', body: '{}' }) as { checkoutUrl: string };
      window.location.assign(result.checkoutUrl);
    } catch (cause) { setError(String(cause)); setCheckoutBusy(false); }
  }
  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    setUser(null); setBilling(null); setLives([]);
  }

  return <main className="shell">
    <div className="top">
      <div><h1>Chánh Điện AI Live</h1><p className="muted">Điều khiển nhiều TikTok LIVE trong một không gian.</p></div>
      {user && <button onClick={() => void logout()}>Đăng xuất</button>}
    </div>
    {loading ? <p>Đang tải...</p> : !user ? <section className="card" style={{ maxWidth: 460 }}>
      <h2>Đăng nhập</h2>
      <form className="stack" onSubmit={signIn}>
        <label>Email hoặc tên đăng nhập<input value={login} onChange={event => setLogin(event.target.value)} required /></label>
        <label>Mật khẩu<input type="password" value={password} onChange={event => setPassword(event.target.value)} required /></label>
        {siteKey && <TurnstileWidget siteKey={siteKey} onToken={setCaptcha} resetSignal={turnstileResetSignal} />}
        <button disabled={signingIn || Boolean(siteKey && !captcha)}>{signingIn ? 'Đang đăng nhập…' : 'Đăng nhập'}</button>
      </form>
    </section> : <>
      <div className="row"><span className="pill">{user.role}</span><span>{user.email}</span>{['ADMIN', 'SUPER_ADMIN'].includes(user.role) && <a href="/admin">Quản trị →</a>}<a href="/battle-arena">Battle Arena →</a></div>
      {billing && <section className="card" style={{ marginTop: 24, maxWidth: 600 }}>
        <h2>Gói sử dụng LIVE</h2>
        {billing.adminFree ? <p className="success">Tài khoản quản trị được sử dụng miễn phí.</p> :
          <p className={billing.active ? 'success' : 'muted'}>{billing.active ? 'Đang sử dụng' : 'Chưa có gói sử dụng hoặc gói đã hết hạn'}{billing.accessUntil ? ' · Hạn đến ' + new Date(billing.accessUntil).toLocaleString('vi-VN') : ''}</p>}
        {!billing.adminFree && <div className="stack">
          <p>50.000₫ cho 24 giờ sử dụng. Gói mua thêm sẽ nối tiếp thời gian còn lại.</p>
          <div className="row"><button disabled={checkoutBusy || !billing.paymentAvailable} onClick={() => void checkout()}>{checkoutBusy ? 'Đang tạo thanh toán…' : billing.active ? 'Nạp thêm 1 ngày' : 'Nạp 50.000₫ qua payOS'}</button>
            {billing.pendingCheckoutUrl && <a href={billing.pendingCheckoutUrl}>Tiếp tục thanh toán →</a>}</div>
          {!billing.paymentAvailable && <p className="error">Thanh toán payOS chưa được cấu hình trên máy chủ.</p>}
          <p className="muted">Quyền sử dụng được cập nhật sau khi payOS xác nhận thanh toán. Nếu vừa thanh toán, hãy đợi vài giây hoặc tải lại trang.</p>
        </div>}
      </section>}
      {(billing?.active || lives.length > 0) && <>
        <h2 style={{ marginTop: 30 }}>LIVE của bạn</h2>
        <div className="grid">{lives.map(live => <article key={live.id} className="card">{billing?.active ? <a href={'/live/' + live.id}><h3>{live.title}</h3><p>@{live.uniqueId}</p><span className="pill">{live.status}</span><p className="muted">Mở bảng điều khiển →</p></a> : <div><h3>{live.title}</h3><p>@{live.uniqueId}</p><span className="pill">{live.status}</span></div>}{user.role !== 'VIEWER' && <button type="button" disabled={deletingLiveId === live.id} onClick={() => void removeLive(live)}>{deletingLiveId === live.id ? 'Đang xóa…' : 'Xóa TikTok ID và dữ liệu'}</button>}</article>)}</div>
        {billing?.active && user.role !== 'VIEWER' && <section className="card" style={{ marginTop: 25, maxWidth: 550 }}>
          <h3>Thêm kênh LIVE</h3>
          <form className="stack" onSubmit={add}>
            <label>Tên hiển thị<input value={title} onChange={event => setTitle(event.target.value)} required /></label>
            <label>TikTok username<input value={uniqueId} onChange={event => setUniqueId(event.target.value)} required placeholder="username" /></label>
            <button>Tạo LIVE</button>
          </form>
        </section>}
      </>}
    </>}
    {error && <p className="error">{error}</p>}
  </main>;
}
