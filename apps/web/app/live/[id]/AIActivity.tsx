'use client';

import { useEffect, useState } from 'react';

type Reply = { id: string; answer: string | null; status: string; createdAt: string };

export default function AIActivity({ id }: { id: string }) {
  const [replies, setReplies] = useState<Reply[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const response = await fetch(`/api/lives/${id}/ai-history`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json() as Reply[];
        if (active) { setReplies(data); setError(''); }
      } catch { if (active) setError('Không tải được lịch sử AI.'); }
    }
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 5000);
    return () => { active = false; clearInterval(interval); };
  }, [id]);

  return <div className="stack">
    <h3>AI đã trả lời</h3>
    <p className="muted">Câu trả lời tiếng Việt hiện trên overlay khi sự kiện tới. Nếu chưa có Google TTS, trình duyệt sẽ thử đọc bằng giọng tiếng Việt.</p>
    {error && <p className="error">{error}</p>}
    {replies.length ? replies.map(reply => <div className="activity" key={reply.id}>
      <small className="muted">{new Date(reply.createdAt).toLocaleString('vi-VN')} · {reply.status}</small>
      <span>{reply.answer || 'Chưa có nội dung'}</span>
    </div>) : <p className="muted">Chưa có câu trả lời. Bật AI, lưu cấu hình và thử nút “Test AI trả lời” trong Simulator.</p>}
  </div>;
}
