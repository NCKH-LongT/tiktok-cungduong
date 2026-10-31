'use client';

import { useEffect, useState, type FormEvent } from 'react';

type Revenue = {
  from: string;
  to: string;
  timeZone: string;
  totalVnd: number;
  paidOrders: number;
  payingUsers: number;
  byDay: { day: string; orders: number; amountVnd: number }[];
  byUser: { userId: string; email: string; username: string; orders: number; amountVnd: number }[];
};

const money = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });

export default function RevenuePage() {
  const [report, setReport] = useState<Revenue | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load(range?: { from: string; to: string }) {
    setLoading(true);
    setError('');
    try {
      const query = range ? `?${new URLSearchParams(range)}` : '';
      const response = await fetch(`/api/admin/revenue${query}`, { cache: 'no-store', credentials: 'include' });
      if (response.status === 401 || response.status === 403) { window.location.assign('/'); return; }
      if (!response.ok) throw new Error('Không tải được thống kê doanh thu.');
      const data = await response.json() as Revenue;
      setReport(data);
      setFrom(data.from);
      setTo(data.to);
    } catch (cause) {
      setReport(null);
      setError(cause instanceof Error ? cause.message : 'Không tải được thống kê doanh thu.');
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    void load({ from, to });
  }

  return <main className="shell">
    <a href="/admin">← Quản trị tài khoản</a>
    <h1 style={{ marginTop: 20 }}>Thống kê doanh thu</h1>
    <p className="muted">Chỉ tính đơn payOS đã thanh toán. Ngày được tính theo giờ Việt Nam (UTC+7).</p>
    <form className="row" onSubmit={submit} style={{ marginBottom: 20 }}>
      <label>Từ ngày<input type="date" value={from} onChange={event => setFrom(event.target.value)} required /></label>
      <label>Đến ngày<input type="date" value={to} onChange={event => setTo(event.target.value)} required /></label>
      <button disabled={loading}>Xem thống kê</button>
    </form>
    {error && <p className="error" role="alert">{error}</p>}
    {loading ? <p>Đang tải...</p> : report && <>
      <div className="metrics-grid" style={{ marginBottom: 20 }}>
        <div className="metric"><small>Doanh thu</small><strong>{money.format(report.totalVnd)}</strong></div>
        <div className="metric"><small>Đơn đã thanh toán</small><strong>{report.paidOrders}</strong></div>
        <div className="metric"><small>Tài khoản thanh toán</small><strong>{report.payingUsers}</strong></div>
      </div>
      <section className="card" style={{ marginBottom: 20 }}>
        <h2>Theo ngày</h2>
        <div className="table-scroll"><table className="data-table"><thead><tr><th>Ngày</th><th>Đơn</th><th>Doanh thu</th></tr></thead><tbody>
          {report.byDay.map(row => <tr key={row.day}><td>{row.day}</td><td>{row.orders}</td><td>{money.format(row.amountVnd)}</td></tr>)}
        </tbody></table></div>
        {!report.byDay.length && <p className="muted">Chưa có đơn thanh toán trong khoảng ngày này.</p>}
      </section>
      <section className="card">
        <h2>Theo tài khoản</h2>
        <div className="table-scroll"><table className="data-table"><thead><tr><th>Tài khoản</th><th>Email</th><th>Đơn</th><th>Doanh thu</th></tr></thead><tbody>
          {report.byUser.map(row => <tr key={row.userId}><td>{row.username}</td><td>{row.email}</td><td>{row.orders}</td><td>{money.format(row.amountVnd)}</td></tr>)}
        </tbody></table></div>
        {!report.byUser.length && <p className="muted">Chưa có tài khoản thanh toán trong khoảng ngày này.</p>}
      </section>
    </>}
  </main>;
}
