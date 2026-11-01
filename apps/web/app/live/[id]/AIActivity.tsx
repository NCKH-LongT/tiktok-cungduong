'use client';

import { useEffect, useState } from 'react';

type Reply = { id: string; answer: string | null; status: string; createdAt: string };
type Usage = { day: string; used: number; limit: number; remaining: number };
const statusLabel: Record<string, string> = { completed: 'Đã tạo câu trả lời', audio_ready: 'MP3 sẵn sàng', fallback_audio: 'AI tạm bận · MP3 sẵn sàng', browser_voice: 'Đang dùng giọng trình duyệt', voice_off: 'Giọng AI đã tắt', fallback: 'AI tạm bận' };

export default function AIActivity({ id }: { id: string }) {
  const [replies, setReplies] = useState<Reply[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const [response, usageResponse] = await Promise.all([fetch(`/api/lives/${id}/ai-history`), fetch(`/api/lives/${id}/ai-usage`)]);
        if (!response.ok || !usageResponse.ok) throw new Error(`HTTP ${response.status}/${usageResponse.status}`);
        const [data, limits] = await Promise.all([response.json() as Promise<Reply[]>, usageResponse.json() as Promise<Usage>]);
        if (active) { setReplies(data); setUsage(limits); setError(''); }
      } catch { if (active) setError('Không tải được lịch sử AI.'); }
    }
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 5000);
    return () => { active = false; clearInterval(interval); };
  }, [id]);

  return <div className="stack">
    <h3>AI đã trả lời</h3>
    <p className="muted">Google TTS tạo MP3 để overlay phát cả khi tab ở nền. Nếu TTS lỗi, giọng dự phòng của trình duyệt có thể cần mở tab hoặc bấm “Bật giọng AI” trong overlay.</p>
    {usage && <p className={usage.remaining ? 'muted' : 'error'}>Lượt AI hôm nay (UTC): {usage.used}/{usage.limit}. {usage.remaining ? `Còn ${usage.remaining} lượt.` : 'Đã hết lượt; AI sẽ trả lời lại vào ngày mai.'}</p>}
    {error && <p className="error">{error}</p>}
    {replies.length ? replies.map(reply => <div className="activity" key={reply.id}>
      <small className="muted">{new Date(reply.createdAt).toLocaleString('vi-VN')} · {statusLabel[reply.status] ?? reply.status}</small>
      <span>{reply.answer || 'Chưa có nội dung'}</span>
    </div>) : <p className="muted">Chưa có câu trả lời. Bật AI rồi thử nút “Test AI trả lời” trong Simulator.</p>}
  </div>;
}
