'use client';

import { useEffect, useState } from 'react';

type Reply = { id: string; answer: string | null; status: string; createdAt: string };
type Usage = { day: string; used: number; limit: number; remaining: number; ttsUsed?: number; ttsLimit?: number; ttsRemaining?: number };
const statusLabel: Record<string, string> = { completed: 'Đã tạo câu trả lời', audio_ready: 'MP3 sẵn sàng', fallback_audio: 'Gemini tạm bận · MP3 sẵn sàng', browser_voice: 'Đang dùng giọng trình duyệt', voice_off: 'Giọng AI đã tắt', fallback: 'Gemini tạm bận', tts_unconfigured: 'Google TTS chưa cấu hình · thử giọng trình duyệt', tts_daily_limit: 'Hết lượt TTS hôm nay · thử giọng trình duyệt', tts_provider_limit: 'Google TTS giới hạn lượt · thử giọng trình duyệt', tts_error: 'Google TTS lỗi · thử giọng trình duyệt' };

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
    <p className="muted">Nếu trạng thái là “MP3 sẵn sàng” mà không nghe tiếng, kiểm tra âm lượng giọng đọc, bật âm thanh xem trước hoặc nguồn âm thanh OBS, và bấm “Bật giọng AI” trên overlay khi trình duyệt yêu cầu. Nếu Google TTS lỗi, giọng dự phòng của trình duyệt có thể cần tab đang mở.</p>
    {usage && <p className={usage.remaining ? 'muted' : 'error'}>Lượt AI hôm nay (UTC): {usage.used}/{usage.limit}. {usage.remaining ? `Còn ${usage.remaining} lượt.` : 'Đã hết lượt; AI sẽ trả lời lại vào ngày mai.'}</p>}
    {usage?.ttsLimit !== undefined && <p className={usage.ttsRemaining ? 'muted' : 'error'}>Lượt giọng đọc Google hôm nay (UTC): {usage.ttsUsed}/{usage.ttsLimit}. {usage.ttsRemaining ? `Còn ${usage.ttsRemaining} lượt.` : 'Đã hết lượt; âm thanh dùng giọng trình duyệt nếu có.'}</p>}
    {error && <p className="error">{error}</p>}
    {replies.length ? replies.map(reply => <div className="activity" key={reply.id}>
      <small className="muted">{new Date(reply.createdAt).toLocaleString('vi-VN')} · {statusLabel[reply.status] ?? reply.status}</small>
      <span>{reply.answer || 'Chưa có nội dung'}</span>
    </div>) : <p className="muted">Chưa có câu trả lời. Bật AI rồi thử nút “Test AI trả lời” trong Simulator.</p>}
  </div>;
}
