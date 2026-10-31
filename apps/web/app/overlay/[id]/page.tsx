'use client';
import { use, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Application, Container, Text } from 'pixi.js';
import MusicPlayer, { type YouTubePlayer } from './music';

type LiveEvent = { eventId: string; eventType: string; source: string; user?: { id?: string; uniqueId?: string; nickname?: string }; payload: Record<string, unknown> };
type Person = { key: string; name: string; seat: number; body: Container; label: Text; state: 'walking' | 'kneeling' | 'bowing' | 'leaving'; x: number; y: number; targetX: number; targetY: number; last: number; bubbleUntil: number; bowUntil: number };
type Speech = { text: string; audio?: string };
const WIDTH = 900, HEIGHT = 1600;

export default function Overlay({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const holder = useRef<HTMLDivElement>(null);
  const musicPlayer = useRef<YouTubePlayer | null>(null);
  const [status, setStatus] = useState('Đang tải...');
  const [leaders, setLeaders] = useState<{ nickname: string; gifts: number }[]>([]);
  const [speech, setSpeech] = useState('');
  const [musicUrl, setMusicUrl] = useState('');
  const [musicVolume, setMusicVolume] = useState(30);

  useEffect(() => {
    let app: Application | undefined, socket: Socket | undefined, disposed = false;
    let scene: Container, camera: Container, audioContext: AudioContext | undefined;
    let ttl = 900000, maxPeople = 40, fishEnabled = false, fishVolume = .3, ttsVolume = .8, musicBase = 30, currentMusic = 30;
    let duckTimer: ReturnType<typeof setInterval> | undefined, currentAudio: HTMLAudioElement | undefined;
    let activeGift: { key: string; until: number } | null = null, speaking = false;
    const giftQueue: string[] = [], speechQueue: Speech[] = [];
    const people = new Map<string, Person>();
    const seats = Array.from({ length: 40 }, (_, index) => ({ x: 120 + (index % 5) * 160, y: 660 + Math.floor(index / 5) * 102, occupied: false }));
    let Pixi: typeof import('pixi.js') | undefined;

    function fish() {
      if (!fishEnabled) return;
      try {
        audioContext ??= new AudioContext();
        void audioContext.resume();
        const osc = audioContext.createOscillator(), gain = audioContext.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(420, audioContext.currentTime);
        osc.frequency.exponentialRampToValueAtTime(180, audioContext.currentTime + .16);
        gain.gain.setValueAtTime(.08 * fishVolume, audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + .2);
        osc.connect(gain).connect(audioContext.destination);
        osc.start(); osc.stop(audioContext.currentTime + .21);
      } catch { /* Audio may be blocked by browser policy. */ }
    }
    function spawn(event: LiveEvent) {
      const key = event.user?.id ?? event.user?.uniqueId;
      if (!key || !scene || !Pixi) return;
      const existing = people.get(key);
      if (existing) { existing.last = Date.now(); return existing; }
      if (people.size >= maxPeople) return;
      const seat = seats.findIndex(item => !item.occupied);
      if (seat < 0) return;
      seats[seat].occupied = true;
      const { Container, Graphics, Text } = Pixi;
      const body = new Container();
      const robe = new Graphics().roundRect(-18, 0, 36, 50, 12).fill(0xb47c3d);
      const head = new Graphics().circle(0, -15, 20).fill(0xe3b68a);
      const arms = new Graphics().roundRect(-27, 6, 54, 9, 5).fill(0xd6a675);
      const name = (event.user?.nickname ?? 'Phật tử').slice(0, 16);
      const label = new Text({ text: name, style: { fill: 0xffffff, fontSize: 16, align: 'center' } });
      label.anchor.set(.5, 1); label.y = -42;
      body.addChild(robe, arms, head, label);
      body.x = 450; body.y = 1520; scene.addChild(body);
      const target = seats[seat];
      const person: Person = { key, name, seat, body, label, state: 'walking', x: 450, y: 1520, targetX: target.x, targetY: target.y, last: Date.now(), bubbleUntil: 0, bowUntil: 0 };
      people.set(key, person);
      return person;
    }
    function onEvent(event: LiveEvent) {
      const key = event.user?.id ?? event.user?.uniqueId ?? '';
      if (event.eventType === 'viewer.leave') {
        const person = people.get(key);
        if (person) { person.state = 'leaving'; person.targetX = 450; person.targetY = 1520; }
        return;
      }
      const person = spawn(event);
      if (event.eventType === 'chat.comment' && person) {
        person.label.text = String(event.payload.text ?? '').slice(0, 45);
        person.bubbleUntil = Date.now() + 3000;
      }
      if (event.eventType === 'gift.received' && person) {
        giftQueue.push(person.key);
        person.state = 'bowing'; person.bowUntil = Date.now() + 1800;
      }
      if (event.eventType === 'viewer.like') fish();
    }
    function duck(target: number) {
      if (duckTimer) clearInterval(duckTimer);
      let step = 0;
      const start = currentMusic;
      duckTimer = setInterval(() => {
        step++;
        currentMusic = Math.round(start + (target - start) * Math.min(1, step / 10));
        musicPlayer.current?.setVolume(currentMusic);
        if (step >= 10 && duckTimer) clearInterval(duckTimer);
      }, 60);
    }
    async function playVoice(job: Speech) {
      if (job.audio) {
        const audio = new Audio('data:audio/mpeg;base64,' + job.audio);
        currentAudio = audio; audio.volume = ttsVolume;
        await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, 20000);
          const done = () => { clearTimeout(timer); resolve(); };
          audio.onended = done; audio.onerror = done;
          void audio.play().catch(done);
        });
        currentAudio = undefined;
      } else if ('speechSynthesis' in window) {
        await new Promise<void>(resolve => {
          const utterance = new SpeechSynthesisUtterance(job.text);
          utterance.lang = 'vi-VN'; utterance.volume = ttsVolume;
          const timer = setTimeout(resolve, 20000);
          const done = () => { clearTimeout(timer); resolve(); };
          utterance.onend = done; utterance.onerror = done;
          window.speechSynthesis.speak(utterance);
        });
      }
    }
    async function playSpeech() {
      if (speaking) return;
      speaking = true;
      while (speechQueue.length && !disposed) {
        const job = speechQueue.shift()!;
        setSpeech(job.text);
        duck(Math.round(musicBase * .25));
        await playVoice(job);
        duck(musicBase);
        setSpeech('');
      }
      speaking = false;
    }
    async function start() {
      Pixi = await import('pixi.js');
      if (disposed) return;
      const { Application, Container, Graphics, Text } = Pixi;
      app = new Application();
      await app.init({ width: WIDTH, height: HEIGHT, background: 0x18120d, antialias: true });
      if (disposed) { app.destroy(true); return; }
      app.canvas.style.width = '100%'; app.canvas.style.height = '100%';
      holder.current?.appendChild(app.canvas);
      camera = new Container(); scene = new Container();
      app.stage.addChild(camera); camera.addChild(scene);
      const background = new Graphics()
        .rect(0, 0, WIDTH, HEIGHT).fill(0x25180e)
        .rect(70, 80, 760, 470).fill(0x3b2415)
        .roundRect(220, 160, 460, 300, 30).fill(0x75502b)
        .roundRect(330, 200, 240, 240, 80).fill(0xc3944d)
        .roundRect(390, 250, 120, 130, 50).fill(0xe2be70)
        .rect(80, 550, 740, 1050).fill(0x4c3825);
      scene.addChild(background);
      scene.addChild(new Graphics().circle(450, 300, 200).fill({ color: 0xffc45e, alpha: .12 }));
      const altar = new Text({ text: 'CHÁNH ĐIỆN', style: { fill: 0xffda91, fontSize: 44, fontWeight: 'bold' } });
      altar.anchor.set(.5); altar.x = 450; altar.y = 475; scene.addChild(altar);
      for (const seat of seats) scene.addChild(new Graphics().roundRect(seat.x - 35, seat.y - 8, 70, 36, 16).fill(0x896a3c));
      camera.pivot.set(450, 800); camera.position.set(450, 800);
      app.ticker.add(ticker => {
        const now = Date.now(), delta = Math.min(ticker.deltaTime, 3);
        for (const person of people.values()) {
          if (person.state === 'walking' || person.state === 'leaving') {
            const dx = person.targetX - person.x, dy = person.targetY - person.y, distance = Math.hypot(dx, dy);
            if (distance < 5) {
              if (person.state === 'leaving') {
                scene.removeChild(person.body); person.body.destroy({ children: true });
                people.delete(person.key); seats[person.seat].occupied = false; continue;
              }
              person.state = 'bowing'; person.bowUntil = now + 1500;
            } else {
              const step = Math.min(distance, 5 * delta);
              person.x += dx / distance * step; person.y += dy / distance * step;
              person.body.rotation = Math.sin(now / 120) * .035;
            }
          } else if (person.state === 'bowing') {
            person.body.scale.y = .78 + Math.sin(now / 120) * .12;
            if (now > person.bowUntil) { person.state = 'kneeling'; person.body.scale.y = .75; person.body.rotation = 0; }
          }
          person.body.x = person.x; person.body.y = person.y;
          if (person.bubbleUntil && now > person.bubbleUntil) { person.label.text = person.name; person.bubbleUntil = 0; }
          if (now - person.last > ttl && person.state !== 'leaving') { person.state = 'leaving'; person.targetX = 450; person.targetY = 1520; }
        }
        if (!activeGift && giftQueue.length) activeGift = { key: giftQueue.shift()!, until: now + 3500 };
        if (activeGift && now > activeGift.until) activeGift = null;
        const focus = activeGift ? people.get(activeGift.key) : undefined;
        const targetX = focus?.x ?? 450, targetY = focus?.y ?? 800, scale = focus ? 1.6 : 1;
        camera.pivot.x += (targetX - camera.pivot.x) * .06;
        camera.pivot.y += (targetY - camera.pivot.y) * .06;
        camera.scale.x += (scale - camera.scale.x) * .06;
        camera.scale.y = camera.scale.x;
      });

      const token = new URLSearchParams(location.search).get('token') ?? '';
      if (!token) { setStatus('Thiếu overlay token'); return; }
      const response = await fetch(`/api/overlay/${id}/snapshot?token=${encodeURIComponent(token)}`);
      if (disposed) return;
      if (!response.ok) { setStatus('Token không hợp lệ hoặc đã thu hồi'); return; }
      const snapshot = await response.json();
      if (disposed) return;
      maxPeople = snapshot.scene?.maxCharacters ?? 40;
      ttl = (snapshot.scene?.inactiveTtlSeconds ?? 900) * 1000;
      fishEnabled = Boolean(snapshot.audio?.woodenFishEnabled);
      fishVolume = (snapshot.audio?.woodenFishVolume ?? 30) / 100;
      ttsVolume = (snapshot.audio?.ttsVolume ?? 80) / 100;
      musicBase = snapshot.audio?.musicVolume ?? 30;
      currentMusic = musicBase;
      setMusicVolume(musicBase);
      setMusicUrl(snapshot.audio?.musicUrl ?? '');
      setLeaders(snapshot.leaderboard ?? []);
      for (const event of snapshot.events ?? []) onEvent(event);
      socket = io(process.env.NEXT_PUBLIC_SOCKET_URL || undefined, { auth: { liveId: id, overlayToken: token } });
      socket.on('connect', () => setStatus('Đã kết nối'));
      socket.on('disconnect', () => setStatus('Mất kết nối · đang thử lại'));
      socket.on('connect_error', () => setStatus('Không thể kết nối socket'));
      socket.on('live.event', (event: LiveEvent) => {
        onEvent(event);
        if (event.eventType === 'gift.received' && event.source === 'tiktok') {
          void fetch(`/api/overlay/${id}/snapshot?token=${encodeURIComponent(token)}`)
            .then(response => response.json()).then(data => setLeaders(data.leaderboard ?? []));
        }
      });
      socket.on('speech.ready', (job: Speech) => {
        speechQueue.push(job);
        if (speechQueue.length > 20) speechQueue.shift();
        void playSpeech();
      });
    }
    void start().catch(() => setStatus('Không tải được cảnh'));
    return () => {
      disposed = true; socket?.disconnect(); app?.destroy(true);
      currentAudio?.pause(); window.speechSynthesis?.cancel();
      if (duckTimer) clearInterval(duckTimer);
      void audioContext?.close();
    };
  }, [id]);

  return <main style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#18120d' }}>
    <div ref={holder} style={{ width: '100%', height: '100%' }} />
    <div style={{ position: 'absolute', top: 20, left: 20, padding: 10, background: '#1b140dcc', borderRadius: 10, color: '#fff' }}>{status}</div>
    <div style={{ position: 'absolute', top: 20, right: 20, padding: 16, background: '#1b140ddd', border: '1px solid #b88a46', borderRadius: 12, color: '#ffe0a0', minWidth: 210 }}>
      <strong>Bảng Tri Ân Phật Tử</strong>
      {leaders.map((leader, index) => <p key={index}>{index + 1}. {leader.nickname ?? 'Ẩn danh'} · {leader.gifts} quà</p>)}
    </div>
    <MusicPlayer url={musicUrl} volume={musicVolume} playerRef={musicPlayer} />
    {speech && <div style={{ position: 'absolute', bottom: 50, left: '10%', right: '10%', padding: 20, background: '#241a12dd', color: '#fff', textAlign: 'center', borderRadius: 18 }}>{speech}</div>}
  </main>;
}
