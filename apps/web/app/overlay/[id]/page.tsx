'use client';
import { use, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import MusicPlayer, { type YouTubePlayer } from './music';

type LiveEvent = { eventId: string; eventType: string; source: string; user?: { id?: string; uniqueId?: string; nickname?: string }; payload: Record<string, unknown> };
type Person = { key: string; name: string; seat: number; body: Container; sprite: Sprite; glow: Graphics; label: Text; state: 'walking' | 'lowering' | 'bowing' | 'kneeling' | 'leaving'; x: number; y: number; targetX: number; targetY: number; last: number; bubbleUntil: number; phaseUntil: number; highlightUntil: number };
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
    let ttl = 900000, maxPeople = 40, reducedMotion = false, fishEnabled = false, fishVolume = .3, ttsVolume = .8, ttsRate = 1, ttsPitch = 0, musicBase = 30, currentMusic = 30;
    let nextAmbientBowAt = Date.now() + 12000;
    let duckTimer: ReturnType<typeof setInterval> | undefined, currentAudio: HTMLAudioElement | undefined;
    let activeGift: { key: string; until: number } | null = null, speaking = false;
    const giftQueue: string[] = [], speechQueue: Speech[] = [];
    const people = new Map<string, Person>();
    const pendingJoins = new Map<string, LiveEvent>();
    const seatColumns = [255, 635, 110, 790, 365];
    const seats = Array.from({ length: 40 }, (_, index) => ({ x: seatColumns[index % 5], y: 1010 + Math.floor(index / 5) * 70, occupied: false }));
    let Pixi: typeof import('pixi.js') | undefined;
    let poses: { standing: Texture; kneeling: Texture; bowing: Texture } | undefined;

    function setPose(person: Person, pose: keyof NonNullable<typeof poses>) {
      if (!poses) return;
      if (person.sprite.texture !== poses[pose]) person.sprite.texture = poses[pose];
      const depth = Math.max(0, Math.min(1, (person.y - 1000) / 550));
      person.sprite.scale.set(.13 + depth * .065);
      person.label.y = -person.sprite.height - 8;
      person.glow.y = -person.sprite.height / 2;
    }

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
    function leave(person: Person) {
      if (person.state === 'leaving') return;
      person.state = 'leaving';
      person.targetX = 450; person.targetY = 1590;
      setPose(person, 'standing');
    }
    function spawn(event: LiveEvent) {
      const key = event.user?.id ?? event.user?.uniqueId;
      if (!key || !scene || !Pixi || !poses) return;
      const existing = people.get(key);
      if (existing) {
        existing.last = Date.now();
        if (existing.state === 'leaving') { existing.state = 'walking'; existing.targetX = seats[existing.seat].x; existing.targetY = seats[existing.seat].y; }
        return existing;
      }
      if (people.size >= maxPeople) {
        if (event.eventType === 'viewer.join') {
          pendingJoins.set(key, event);
          if (pendingJoins.size > 40) pendingJoins.delete(pendingJoins.keys().next().value!);
          const oldest = [...people.values()].filter(person => person.state !== 'leaving').sort((a, b) => a.last - b.last)[0];
          if (oldest) leave(oldest);
        }
        return;
      }
      const seat = seats.findIndex(item => !item.occupied);
      if (seat < 0) return;
      seats[seat].occupied = true;
      const { Container, Graphics, Sprite, Text } = Pixi;
      const body = new Container();
      const glow = new Graphics().circle(0, 0, 58).fill({ color: 0xffdc7c, alpha: .45 });
      glow.alpha = 0;
      const sprite = new Sprite(poses.standing);
      sprite.anchor.set(.5, 1);
      const name = (event.user?.nickname ?? 'Phật tử').slice(0, 16);
      const label = new Text({ text: name, style: { fill: 0xffffff, fontSize: 16, align: 'center' } });
      label.anchor.set(.5, 1);
      body.addChild(glow, sprite, label);
      body.x = 450; body.y = 1590; scene.addChild(body);
      const target = seats[seat];
      body.zIndex = target.y;
      const person: Person = { key, name, seat, body, sprite, glow, label, state: 'walking', x: 450, y: 1590, targetX: target.x, targetY: target.y, last: Date.now(), bubbleUntil: 0, phaseUntil: 0, highlightUntil: 0 };
      setPose(person, 'standing');
      people.set(key, person);
      return person;
    }
    function onEvent(event: LiveEvent) {
      if (event.eventType === 'room.stats') {
        const count = event.payload.viewerCount;
        if (typeof count === 'number' && Number.isFinite(count) && count >= 0) {
          const active = [...people.values()].filter(person => person.state !== 'leaving').sort((a, b) => a.last - b.last);
          for (const person of active.slice(0, Math.max(0, active.length - count))) leave(person);
          if (count === 0) pendingJoins.clear();
        }
        return;
      }
      const key = event.user?.id ?? event.user?.uniqueId ?? '';
      if (event.eventType === 'viewer.leave') {
        const person = people.get(key);
        pendingJoins.delete(key);
        if (person) leave(person);
        return;
      }
      const person = spawn(event);
      if (event.eventType === 'chat.comment' && person) {
        person.label.text = String(event.payload.text ?? '').slice(0, 45);
        person.bubbleUntil = Date.now() + 3000;
      }
      if (event.eventType === 'gift.received' && person) {
        giftQueue.push(person.key);
        person.highlightUntil = Date.now() + 3500;
        if (person.state === 'kneeling') { person.state = 'bowing'; person.phaseUntil = Date.now() + 1000; setPose(person, 'bowing'); }
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
          utterance.lang = 'vi-VN'; utterance.volume = ttsVolume; utterance.rate = ttsRate; utterance.pitch = Math.max(0, Math.min(2, 1 + ttsPitch / 10));
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
      const { Application, Container, Sprite, Texture, Rectangle, Assets } = Pixi;
      const [backgroundTexture, sheet] = await Promise.all([
        Assets.load<Texture>('/overlay/chanhdien.png'),
        Assets.load<Texture>('/overlay/nhanvat01.png'),
      ]);
      if (disposed) return;
      poses = {
        standing: new Texture({ source: sheet.source, frame: new Rectangle(0, 65, 285, 880) }),
        kneeling: new Texture({ source: sheet.source, frame: new Rectangle(285, 330, 285, 605) }),
        bowing: new Texture({ source: sheet.source, frame: new Rectangle(570, 640, 395, 300) }),
      };
      app = new Application();
      await app.init({ width: WIDTH, height: HEIGHT, background: 0x18120d, antialias: true });
      if (disposed) { app.destroy(true); return; }
      app.canvas.style.width = '100%'; app.canvas.style.height = '100%';
      holder.current?.appendChild(app.canvas);
      camera = new Container(); scene = new Container(); scene.sortableChildren = true;
      app.stage.addChild(camera); camera.addChild(scene);
      const background = new Sprite(backgroundTexture);
      background.width = WIDTH; background.height = HEIGHT;
      scene.addChild(background);
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
              person.state = 'lowering'; person.phaseUntil = now + 650;
              person.body.rotation = 0;
              setPose(person, 'kneeling');
            } else {
              const step = Math.min(distance, 7 * delta);
              person.x += dx / distance * step; person.y += dy / distance * step;
              person.body.rotation = Math.sin(now / 130) * .04;
              setPose(person, 'standing');
            }
          } else if (person.state === 'lowering' && now > person.phaseUntil) {
            person.state = 'bowing'; person.phaseUntil = now + 1050;
            setPose(person, 'bowing');
          } else if (person.state === 'bowing' && now > person.phaseUntil) {
            person.state = 'kneeling';
            setPose(person, 'kneeling');
          }
          person.body.x = person.x; person.body.y = person.y;
          person.glow.alpha = now < person.highlightUntil ? .75 + Math.sin(now / 120) * .15 : 0;
          if (person.bubbleUntil && now > person.bubbleUntil) { person.label.text = person.name; person.bubbleUntil = 0; }
          if (now - person.last > ttl) leave(person);
        }
        while (pendingJoins.size && people.size < maxPeople && seats.some(seat => !seat.occupied)) {
          const [key, event] = pendingJoins.entries().next().value!;
          pendingJoins.delete(key);
          spawn(event);
        }
        if (now >= nextAmbientBowAt) {
          nextAmbientBowAt = now + 8000 + Math.random() * 14000;
          if (!reducedMotion) {
            const resting = [...people.values()].filter(person => person.state === 'kneeling');
            const person = resting[Math.floor(Math.random() * resting.length)];
            if (person) { person.state = 'bowing'; person.phaseUntil = now + 950; setPose(person, 'bowing'); }
          }
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
      reducedMotion = Boolean(snapshot.scene?.reducedMotion);
      fishEnabled = Boolean(snapshot.audio?.woodenFishEnabled);
      fishVolume = (snapshot.audio?.woodenFishVolume ?? 30) / 100;
      ttsVolume = (snapshot.audio?.ttsVolume ?? 80) / 100;
      ttsRate = snapshot.audio?.speakingRate ?? 1;
      ttsPitch = snapshot.audio?.pitch ?? 0;
      musicBase = snapshot.audio?.musicVolume ?? 30;
      currentMusic = musicBase;
      setMusicVolume(musicBase);
      setMusicUrl(snapshot.audio?.musicUrl ?? '');
      setLeaders(snapshot.leaderboard ?? []);
      for (const event of snapshot.events ?? []) onEvent(event);
      for (const viewer of snapshot.activeViewers ?? []) {
        if (people.has(viewer.userKey)) continue;
        const person = spawn({ eventId: 'restore:' + viewer.userKey, eventType: 'viewer.join', source: 'tiktok', user: { id: viewer.userKey, nickname: viewer.nickname ?? 'Phật tử' }, payload: {} });
        if (person) person.last = new Date(viewer.lastSeenAt).getTime();
      }
      if (snapshot.roomStats) onEvent(snapshot.roomStats);
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
