'use client';

import { useEffect, useState } from 'react';

export default function GeminiKeySettings({ id }: { id: string }) {
  const [hasKey, setHasKey] = useState(false);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    void fetch(`/api/lives/${id}/ai-config`).then(async response => {
      if (!response.ok) throw new Error('Không tải được trạng thái khóa');
      const data = await response.json() as { hasCustomApiKey?: boolean };
      if (active) setHasKey(Boolean(data.hasCustomApiKey));
    }).catch(() => { if (active) setMessage('Không tải được trạng thái khóa Gemini.'); });
    return () => { active = false; };
  }, [id]);

  async function save(apiKey: string | null) {
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`/api/lives/${id}/ai-config`, { method: 'PUT', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey }) });
      const data = await response.json() as { error?: string; hasCustomApiKey?: boolean };
      if (!response.ok) throw new Error(data.error ?? 'Không lưu được khóa Gemini');
      setHasKey(Boolean(data.hasCustomApiKey));
      setKey('');
      setMessage(apiKey ? 'Đã lưu khóa Gemini riêng.' : 'Đã xóa khóa riêng; LIVE sẽ dùng khóa hệ thống nếu có.');
    } catch (error) { setMessage(String(error)); }
    finally { setBusy(false); }
  }

  return <div className="stack">
    <h3>Khóa Gemini cho LIVE này</h3>
    <p className="muted">{hasKey ? 'Đã có khóa riêng, được mã hóa trên máy chủ.' : 'Chưa có khóa riêng; AI dùng khóa hệ thống nếu đã cấu hình.'} Khóa đã lưu không hiển thị lại.</p>
    <label>Gemini API key<input type="password" value={key} onChange={event => setKey(event.target.value)} autoComplete="off" placeholder="Dán khóa Gemini riêng" /></label>
    <div className="row"><button type="button" disabled={busy || key.trim().length < 20} onClick={() => void save(key.trim())}>Lưu khóa</button>{hasKey && <button type="button" disabled={busy} onClick={() => void save(null)}>Xóa khóa riêng</button>}</div>
    {message && <p role="status" className="muted">{message}</p>}
  </div>;
}
