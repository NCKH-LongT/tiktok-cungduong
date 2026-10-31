'use client';

import { useEffect, useState } from 'react';

type Analytics = {
  currentViewers: number | null;
  totalViewers: number | null;
  uniqueJoiners: number;
  comments: number;
  giftEvents: number;
  gifts: number;
  likeEvents: number;
  hearts: number;
  shares: number;
  roomStatsAt?: string | null;
  recentComments: { viewerKey: string | null; nickname: string; text: string; at: string }[];
  recentGifts: { nickname: string; giftName: string; quantity: number; at: string }[];
  topGifts: { giftName: string; quantity: number }[];
};

function number(value: number | null | undefined) {
  return value == null ? '—' : new Intl.NumberFormat('vi-VN').format(value);
}

function clock(value: string) {
  return new Date(value).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function Metric({ label, value, hint }: { label: string; value: number | null | undefined; hint?: string }) {
  return <div className="metric"><span className="muted">{label}</span><strong>{number(value)}</strong>{hint && <small className="muted">{hint}</small>}</div>;
}

export default function LiveStats({ id, details = false }: { id: string; details?: boolean }) {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState('');
  const [conversation, setConversation] = useState<{ name: string; messages: { role: string; text: string; at: string }[] } | null>(null);

  async function showConversation(viewerKey: string, name: string) {
    try {
      const response = await fetch(`/api/lives/${id}/conversation/${encodeURIComponent(viewerKey)}`);
      if (!response.ok) throw new Error('Không tải được lịch sử hội thoại');
      const data = await response.json() as { messages: { role: string; text: string; at: string }[] };
      setConversation({ name, messages: data.messages });
    } catch (cause) { setError(String(cause)); }
  }

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const response = await fetch('/api/lives/' + id + '/analytics');
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? 'Không tải được thống kê');
        if (!cancelled) { setData(result); setError(''); }
      } catch (cause) { if (!cancelled) setError(String(cause)); }
    }
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [id]);

  if (error && !data) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Đang tải số liệu...</p>;

  return <div className="stack">
    <div className="metrics-grid">
      <Metric label="Đang trong room" value={data.currentViewers} hint="TikTok báo trực tiếp" />
      <Metric label="Tổng lượt vào" value={data.totalViewers} hint="TikTok báo cho phiên LIVE" />
      <Metric label="Người đã nhận diện" value={data.uniqueJoiners} hint="ID duy nhất từ sự kiện vào" />
      <Metric label="Bình luận" value={data.comments} />
      <Metric label="Quà tặng" value={data.gifts} hint={number(data.giftEvents) + ' lượt gửi'} />
      <Metric label="Lượt bấm thích" value={data.likeEvents} hint="Số sự kiện like" />
      <Metric label="Tim" value={data.hearts} hint="Tổng count trong sự kiện like" />
      <Metric label="Chia sẻ" value={data.shares} />
    </div>
    <p className="muted">Số liệu của phòng LIVE TikTok gần nhất; simulator không được cộng vào. {data.roomStatsAt && 'Số người cập nhật lúc ' + clock(data.roomStatsAt) + '.'}</p>
    {error && <p className="error">Lần cập nhật gần nhất thất bại: {error}</p>}
    <h3>Bình luận mới nhất</h3>
    <div className="activity-list">
      {data.recentComments.length ? data.recentComments.slice(0, details ? 30 : 8).map((item, index) => <div className="activity" key={item.at + index}>
        <span><strong>{item.nickname}</strong> <span className="muted">· {clock(item.at)}</span>{item.viewerKey && <button type="button" onClick={() => void showConversation(item.viewerKey!, item.nickname)}>Lịch sử</button>}</span>
        <span>{item.text}</span>
      </div>) : <p className="muted">{data.comments ? 'Nội dung bình luận cũ chưa được lưu; bình luận mới sẽ hiển thị tại đây.' : 'Chưa có bình luận TikTok trong phiên LIVE này.'}</p>}
    </div>
    {conversation && <div className="card"><h3>Hội thoại với {conversation.name}</h3><button type="button" onClick={() => setConversation(null)}>Đóng</button>{conversation.messages.map((item, index) => <p key={item.at + index}><strong>{item.role === 'ai' ? 'AI' : conversation.name}</strong> · {clock(item.at)}<br />{item.text}</p>)}</div>}
    {details && <div className="analytics-columns">
      <div><h3>Quà tặng phổ biến</h3>{data.topGifts.length ? data.topGifts.map(item => <p key={item.giftName}>{item.giftName} · {number(item.quantity)}</p>) : <p className="muted">Chưa có quà tặng.</p>}</div>
      <div><h3>Quà gần đây</h3>{data.recentGifts.length ? data.recentGifts.map((item, index) => <p key={item.at + index}>{item.nickname} · {item.giftName} × {number(item.quantity)} <span className="muted">{clock(item.at)}</span></p>) : <p className="muted">Chưa có quà tặng.</p>}</div>
    </div>}
  </div>;
}
