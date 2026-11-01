'use client';

import { useEffect, useState, type FormEvent } from 'react';

type TtsProvider = 'google' | 'local';
type User = { id: string; email: string; username: string; role: string; active: boolean; ttsProvider: TtsProvider; maxAiReplyWords: number; aiUsageDay: string; aiUsedToday: number; aiLimitToday: number; canResetAiUsage: boolean };

export default function Admin() {
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busyId, setBusyId] = useState('');
  const [replyLimits, setReplyLimits] = useState<Record<string, string>>({});

  async function load() {
    const response = await fetch('/api/users', { cache: 'no-store' });
    if (!response.ok) throw new Error('Không tải được danh sách tài khoản.');
    setUsers(await response.json() as User[]);
  }

  useEffect(() => { void load().catch(cause => setError(String(cause))); }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      const response = await fetch('/api/users', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, username, password, role: 'USER' }) });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? 'Không tạo được tài khoản.');
      setEmail(''); setUsername(''); setPassword('');
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không tạo được tài khoản.'); }
  }

  async function update(user: User, changes: { active?: boolean; ttsProvider?: TtsProvider; maxAiReplyWords?: number }) {
    setBusyId(user.id);
    setError('');
    try {
      const response = await fetch(`/api/users/${user.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(changes) });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? 'Không lưu được thay đổi.');
      await load();
      if (changes.maxAiReplyWords !== undefined) setReplyLimits(current => { const next = { ...current }; delete next[user.id]; return next; });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không lưu được thay đổi.'); }
    finally { setBusyId(''); }
  }

  async function resetAiUsage(user: User) {
    if (!window.confirm(`Đặt lại lượt AI hôm nay cho ${user.email}?`)) return;
    setBusyId(user.id);
    setError(''); setNotice('');
    try {
      const response = await fetch(`/api/users/${user.id}/ai-usage/reset`, { method: 'POST' });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? 'Không đặt lại được lượt AI.');
      await load();
      setNotice(`Đã đặt lại lượt AI hôm nay cho ${user.email}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không đặt lại được lượt AI.'); }
    finally { setBusyId(''); }
  }

  return <main className="shell">
    <a href="/">← Dashboard</a>
    <h1>Quản trị tài khoản</h1>
    <p><a href="/admin/revenue">Xem thống kê doanh thu →</a></p>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="muted" role="status">{notice}</p>}
    <div className="split">
      <section className="card">
        <h2>Tạo tài khoản</h2>
        <form className="stack" onSubmit={create}>
          <label>Email<input value={email} onChange={event => setEmail(event.target.value)} required type="email" /></label>
          <label>Username<input value={username} onChange={event => setUsername(event.target.value)} required /></label>
          <label>Mật khẩu ban đầu<input value={password} onChange={event => setPassword(event.target.value)} required type="password" minLength={16} /></label>
          <button>Tạo</button>
        </form>
      </section>
      <section className="card">
        <h2>Người dùng</h2>
        <p className="muted">Nguồn giọng đọc và giới hạn số từ áp dụng cho mọi LIVE của tài khoản. Nếu nguồn đã chọn lỗi, hệ thống thử nguồn còn lại. Lượt AI tính theo ngày UTC cho toàn tài khoản.</p>
        {users.map(user => <div className="row" key={user.id} style={{ padding: '10px 0', borderBottom: '1px solid #4a3826' }}>
          <span>{user.email} · {user.role}</span>
          <label>Giọng đọc
            <select value={user.ttsProvider} disabled={busyId === user.id} onChange={event => void update(user, { ttsProvider: event.target.value as TtsProvider })}>
              <option value="google">Google trước</option>
              <option value="local">Local trước</option>
            </select>
          </label>
          <label>Phản hồi AI tối đa (từ)
            <input type="number" min="15" max="100" value={replyLimits[user.id] ?? user.maxAiReplyWords} disabled={busyId === user.id} onChange={event => setReplyLimits(current => ({ ...current, [user.id]: event.target.value }))} style={{ width: 85 }} />
          </label>
          <button disabled={busyId === user.id || replyLimits[user.id] === undefined || !Number.isInteger(Number(replyLimits[user.id])) || Number(replyLimits[user.id]) < 15 || Number(replyLimits[user.id]) > 100} onClick={() => void update(user, { maxAiReplyWords: Number(replyLimits[user.id]) })}>Lưu số từ</button>
          <span title={`Ngày UTC: ${user.aiUsageDay}`}>Lượt AI hôm nay: {user.aiUsedToday}/{user.aiLimitToday}</span>
          {user.canResetAiUsage && <button disabled={busyId === user.id} onClick={() => void resetAiUsage(user)}>Đặt lại lượt AI</button>}
          {user.role !== 'SUPER_ADMIN' && <button disabled={busyId === user.id} onClick={() => void update(user, { active: !user.active })}>{user.active ? 'Khóa' : 'Mở khóa'}</button>}
        </div>)}
      </section>
    </div>
  </main>;
}
