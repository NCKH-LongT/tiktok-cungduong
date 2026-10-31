'use client';
import { useEffect, useRef, useState, type MutableRefObject } from 'react';

export type YouTubePlayer = { setVolume: (value: number) => void; playVideo: () => void; destroy: () => void };
type YouTubeApi = { Player: new (element: HTMLElement, options: Record<string, unknown>) => YouTubePlayer };
type WindowWithYouTube = typeof window & { YT?: YouTubeApi; onYouTubeIframeAPIReady?: () => void };

export function videoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase();
    let id: string | null = null;
    if (host === 'youtu.be') id = parsed.pathname.slice(1);
    else if (host === 'youtube.com' || host === 'www.youtube.com') {
      id = parsed.pathname === '/watch' ? parsed.searchParams.get('v') : parsed.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1] ?? null;
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}

export default function MusicPlayer({ url, volume, playerRef }: { url: string; volume: number; playerRef: MutableRefObject<YouTubePlayer | null> }) {
  const mount = useRef<HTMLDivElement>(null);
  const [blocked, setBlocked] = useState(false);
  const id = videoId(url);

  useEffect(() => {
    if (!id) return;
    const win = window as WindowWithYouTube;
    let active = true;
    const initialize = () => {
      if (!active || !mount.current || !win.YT || playerRef.current) return;
      playerRef.current = new win.YT.Player(mount.current, {
        width: '220', height: '200', videoId: id,
        playerVars: { autoplay: 1, controls: 1, playsinline: 1, origin: window.location.origin },
        events: {
          onReady: ({ target }: { target: YouTubePlayer }) => { target.setVolume(volume); target.playVideo(); },
          onAutoplayBlocked: () => setBlocked(true),
        },
      });
    };
    win.onYouTubeIframeAPIReady = initialize;
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onload = initialize;
    document.head.appendChild(script);
    initialize();
    return () => { active = false; playerRef.current?.destroy(); playerRef.current = null; script.remove(); delete win.onYouTubeIframeAPIReady; };
  }, [id, playerRef]);

  useEffect(() => { playerRef.current?.setVolume(volume); }, [volume, playerRef]);
  if (!id) return null;
  return <div style={{ position: 'absolute', bottom: 10, left: 10, width: 220, padding: 6, background: '#1b140ddd', borderRadius: 10 }}>
    <div ref={mount} style={{ width: 220, height: 200 }} />
    {blocked && <button onClick={() => { playerRef.current?.playVideo(); setBlocked(false); }} style={{ width: '100%' }}>Bật nhạc</button>}
  </div>;
}
