'use client';
import { useEffect, useRef, useState, type MutableRefObject } from 'react';

export type YouTubePlayer = { setVolume: (value: number) => void; playVideo: () => void; pauseVideo: () => void; destroy: () => void };
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

export default function MusicPlayer({ url, volume, playing, playerRef }: { url: string; volume: number; playing: boolean; playerRef: MutableRefObject<YouTubePlayer | null> }) {
  const mount = useRef<HTMLDivElement>(null);
  const [blocked, setBlocked] = useState(false);
  const playingRef = useRef(playing);
  const volumeRef = useRef(volume);
  playingRef.current = playing;
  volumeRef.current = volume;
  const id = videoId(url);

  useEffect(() => {
    if (!id) return;
    const win = window as WindowWithYouTube;
    let active = true;
    const initialize = () => {
      if (!active || !mount.current || !win.YT || playerRef.current) return;
      playerRef.current = new win.YT.Player(mount.current, {
        width: '200', height: '200', videoId: id,
        playerVars: { autoplay: 0, controls: 0, playsinline: 1, origin: window.location.origin },
        events: {
          onReady: ({ target }: { target: YouTubePlayer }) => { target.setVolume(volumeRef.current); if (playingRef.current) target.playVideo(); },
          onAutoplayBlocked: () => setBlocked(true),
          onStateChange: ({ data }: { data: number }) => { if (data === 1) setBlocked(false); },
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
  useEffect(() => { if (playing) playerRef.current?.playVideo(); else playerRef.current?.pauseVideo(); }, [playing, playerRef]);
  if (!id) return null;
  return <>
    <div ref={mount} aria-hidden="true" style={{ position: 'absolute', width: 200, height: 200, left: 0, top: 0, opacity: 0, pointerEvents: 'none' }} />
    {blocked && playing && <button style={{ position: 'absolute', bottom: 16, left: 16, zIndex: 10 }} onClick={() => playerRef.current?.playVideo()}>Bật nhạc YouTube</button>}
  </>;
}
