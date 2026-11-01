'use client';
import { use, useEffect, useRef, useState, type CSSProperties } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import MusicPlayer, { type YouTubePlayer } from './music';
import BuddhistUserBadge from './BuddhistUserBadge';
import styles from './overlay.module.css';

type LiveEvent = { eventId: string; eventType: string; source: string; user?: { id?: string; uniqueId?: string; nickname?: string; avatarUrl?: string }; payload: Record<string, unknown> };
type Person = { key: string; name: string; avatarUrl?: string; seat: number; body: Container; sprite: Sprite; glow: Graphics; label: Text; totalGiftCoins: number; state: 'walking' | 'lowering' | 'bowing' | 'kneeling' | 'leaving'; x: number; y: number; targetX: number; targetY: number; last: number; bubbleUntil: number; phaseUntil: number; highlightUntil: number; badgeBrightAt: number };
type Badge = { key: string; name: string; avatarUrl?: string; vip: boolean };
type Speech = { text: string; audio?: string; source?: string; voiceEnabled?: boolean };
type Prayer = { id: string; name: string; avatarUrl?: string; text: string; top: number; duration: number };
type FallingGift = { id: string; name: string; imageUrl?: string; left: number; top: number; size: number; duration: number; drift: number; spin: number };
const WIDTH = 900, HEIGHT = 1600;
const giftPoints = (payload: Record<string, unknown>) => {
  const coins = Number(payload.estimatedCoins);
  const quantity = Number(payload.quantity);
  return Math.max(1, Number.isFinite(coins) ? coins : 1) * Math.max(1, Number.isFinite(quantity) ? quantity : 1);
};

export default function Overlay({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const holder = useRef<HTMLDivElement>(null);
  const badgeRefs = useRef(new Map<string, HTMLDivElement>());
  const musicPlayer = useRef<YouTubePlayer | null>(null);
  const retryVoiceRef = useRef<(() => void) | null>(null);
  const unlockVoiceRef = useRef<(() => void) | null>(null);
  const previewMutedRef = useRef(false);
  const [previewMuted, setPreviewMuted] = useState(false);
  const [status, setStatus] = useState('');
  const [leaders, setLeaders] = useState<{ viewerKey: string; avatarUrl?: string; gifts: number; points: number }[]>([]);
  const [speech, setSpeech] = useState('');
  const [musicUrl, setMusicUrl] = useState('');
  const [musicVolume, setMusicVolume] = useState(30);
  const [livePlaying, setLivePlaying] = useState(false);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [focusedBadge, setFocusedBadge] = useState<Badge | null>(null);
  const [voiceBlocked, setVoiceBlocked] = useState(false);
  const [voiceReady, setVoiceReady] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [prayers, setPrayers] = useState<Prayer[]>([]);
  const [fallingGifts, setFallingGifts] = useState<FallingGift[]>([]);

  useEffect(() => {
    let app: Application | undefined, socket: Socket | undefined, disposed = false;
    let leaderboardRequest = 0;
    let scene: Container, camera: Container, audioContext: AudioContext | undefined;
    let ttl = 900000, maxPeople = 40, reducedMotion = false, fishEnabled = false, fishVolume = .3, ttsVolume = .8, ttsRate = 1, ttsPitch = 0, musicBase = 30, currentMusic = 30;
    let nextAmbientBowAt = Date.now() + 10000, liveActive = false, voiceAllowed = true;
    let duckTimer: ReturnType<typeof setInterval> | undefined, currentSource: AudioBufferSourceNode | undefined, currentGain: GainNode | undefined;
    let speechDisplayTimer: ReturnType<typeof setTimeout> | undefined;
    let activeGift: { key: string; until: number } | null = null, focusedKey = '', speaking = false, stopVersion = 0;
    let voicePlaybackBlocked = false;
    const speechQueue: Speech[] = [];
    const people = new Map<string, Person>();
    const vipViewerKeys = new Set<string>();
    const giftCoinsByViewer = new Map<string, number>();
    const pendingJoins = new Map<string, LiveEvent>();
    const seatColumns = [255, 635, 110, 790, 365];
    const seats = Array.from({ length: 40 }, (_, index) => ({ x: seatColumns[index % 5], y: 1010 + Math.floor(index / 5) * 70, occupied: false }));
    let Pixi: typeof import('pixi.js') | undefined;
    let poses: { standing: Texture; kneeling: Texture; bowing: Texture } | undefined;
    let blurFilter: import('pixi.js').BlurFilter | undefined;
    const params = new URLSearchParams(location.search);
    previewMutedRef.current = params.get('preview') === '1' && params.get('muted') !== '0';
    setPreviewMuted(previewMutedRef.current);
    const onPreviewAudio = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== window.location.origin || event.data?.type !== 'overlay.preview-audio') return;
      previewMutedRef.current = Boolean(event.data.muted);
      setPreviewMuted(previewMutedRef.current);
      if (currentGain) currentGain.gain.value = previewMutedRef.current ? 0 : ttsVolume;
      if (previewMutedRef.current) window.speechSynthesis?.cancel();
      musicPlayer.current?.setVolume(previewMutedRef.current ? 0 : currentMusic);
      if (!previewMutedRef.current) {
        voicePlaybackBlocked = false;
        void audioContext?.resume();
        if (liveActive) musicPlayer.current?.playVideo();
        void playSpeech();
      }
    };
    window.addEventListener('message', onPreviewAudio);
    if (params.get('preview') === '1') window.parent.postMessage({ type: 'overlay.preview-ready' }, window.location.origin);

    function showBadge(person: Person) {
      setBadges(current => {
        const badge = { key: person.key, name: person.name, avatarUrl: person.avatarUrl, vip: vipViewerKeys.has(person.key) };
        const index = current.findIndex(item => item.key === person.key);
        if (index < 0) return [...current, badge];
        if (current[index].name === badge.name && current[index].avatarUrl === badge.avatarUrl && current[index].vip === badge.vip) return current;
        return current.map(item => item.key === badge.key ? badge : item);
      });
    }

    function setPose(person: Person, pose: keyof NonNullable<typeof poses>) {
      if (!poses) return;
      if (person.sprite.texture !== poses[pose]) person.sprite.texture = poses[pose];
      const depth = Math.max(0, Math.min(1, (person.y - 1000) / 550));
      person.sprite.scale.set(.13 + depth * .065);
      person.label.y = -person.sprite.height - 8;
      person.glow.y = -person.sprite.height / 2;
    }

    function fish() {
      if (!fishEnabled || previewMutedRef.current) return;
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
    function removePerson(person: Person) {
      scene.removeChild(person.body); person.body.destroy({ children: true });
      people.delete(person.key); seats[person.seat].occupied = false;
      setBadges(current => current.filter(item => item.key !== person.key));
      badgeRefs.current.delete(person.key);
    }
    function stopLiveScene() {
      stopVersion++;
      if (duckTimer) clearInterval(duckTimer);
      if (speechDisplayTimer) clearTimeout(speechDisplayTimer);
      currentMusic = 0;
      pendingJoins.clear(); speechQueue.length = 0;
      voicePlaybackBlocked = false;
      activeGift = null; focusedKey = '';
      for (const person of people.values()) { scene.removeChild(person.body); person.body.destroy({ children: true }); seats[person.seat].occupied = false; }
      people.clear(); badgeRefs.current.clear(); vipViewerKeys.clear(); giftCoinsByViewer.clear(); setBadges([]); setFocusedBadge(null); setLeaders([]); setPrayers([]); setFallingGifts([]); setSpeech('');
      try { currentSource?.stop(); } catch { /* The source already finished. */ }
      window.speechSynthesis?.cancel();
      musicPlayer.current?.setVolume(0); musicPlayer.current?.pauseVideo();
    }
    function spawn(event: LiveEvent) {
      const key = event.user?.id ?? event.user?.uniqueId;
      if (!key || !scene || !Pixi || !poses) return;
      const existing = people.get(key);
      if (existing) {
        existing.last = Date.now();
        let badgeChanged = false;
        if (event.user?.nickname && existing.name !== event.user.nickname) { existing.name = event.user.nickname; existing.label.text = existing.name.slice(0, 16); badgeChanged = true; }
        if (event.user?.avatarUrl && existing.avatarUrl !== event.user.avatarUrl) { existing.avatarUrl = event.user.avatarUrl; badgeChanged = true; }
        if (badgeChanged) showBadge(existing);
        if (existing.state === 'leaving') { existing.state = 'walking'; existing.targetX = seats[existing.seat].x; existing.targetY = seats[existing.seat].y; }
        return existing;
      }
      if (event.eventType === 'gift.received' && (people.size >= maxPeople || seats.every(seat => seat.occupied))) {
        const candidates = [...people.values()].sort((a, b) => a.last - b.last);
        const oldest = candidates.find(person => person.key !== focusedKey) ?? candidates[0];
        if (oldest) removePerson(oldest);
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
      const glow = new Graphics()
        .circle(0, 0, 79).fill({ color: 0xf5a900, alpha: .35 })
        .circle(0, 0, 61).stroke({ color: 0xffd21f, alpha: 1, width: 8 })
        .circle(0, 0, 45).fill({ color: 0xffec90, alpha: .55 });
      glow.alpha = 0;
      const sprite = new Sprite(poses.standing);
      sprite.anchor.set(.5, 1);
      const name = event.user?.nickname ?? 'Phật tử';
      const label = new Text({ text: name.slice(0, 16), style: { fill: 0xffffff, fontSize: 16, align: 'center' } });
      label.anchor.set(.5, 1);
      label.visible = false;
      body.addChild(glow, sprite, label);
      body.x = 450; body.y = 1590; scene.addChild(body);
      const target = seats[seat];
      body.zIndex = target.y;
      const person: Person = { key, name, avatarUrl: event.user?.avatarUrl, seat, body, sprite, glow, label, totalGiftCoins: giftCoinsByViewer.get(key) ?? 0, state: 'walking', x: 450, y: 1590, targetX: target.x, targetY: target.y, last: Date.now(), bubbleUntil: 0, phaseUntil: 0, highlightUntil: 0, badgeBrightAt: Date.now() };
      if (focusedKey && key !== focusedKey && blurFilter) body.filters = [blurFilter];
      setPose(person, 'standing');
      people.set(key, person);
      showBadge(person);
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
        person.label.visible = true;
        person.bubbleUntil = Date.now() + 3000;
      }
      if (event.eventType === 'chat.comment') {
        const message = String(event.payload.text ?? '').trim();
        if (/^Cầu\s*:/iu.test(message)) {
          setPrayers(current => [...current.slice(-7), { id: event.eventId, name: event.user?.nickname ?? 'Phật tử', avatarUrl: event.user?.avatarUrl, text: message, top: 18 + Math.random() * 64, duration: 10 + Math.min(15, message.length * .09) + Math.random() * 4 }]);
        }
      }
      if (event.eventType === 'gift.received' && event.payload.repeatEnd !== false) {
        const points = giftPoints(event.payload);
        const size = Math.min(146, 42 + Math.log10(points + 1) * 28);
        const side = Math.random() < .5 ? 0 : 1;
        const image = event.payload.giftImageUrl;
        const imageUrl = typeof image === 'string' && /^https:\/\//i.test(image) ? image : undefined;
        setFallingGifts(current => [...current.slice(-11), { id: event.eventId, name: String(event.payload.giftName ?? 'Quà tặng'), imageUrl, left: side ? 59 + Math.random() * 34 : 7 + Math.random() * 34, top: 10 + Math.random() * 38, size, duration: 2.5 + Math.random() * 1.4, drift: (Math.random() - .5) * 140, spin: (Math.random() - .5) * 80 }]);
        if (person) {
          activeGift = { key: person.key, until: Date.now() + 5000 };
          person.totalGiftCoins += points;
          giftCoinsByViewer.set(person.key, person.totalGiftCoins);
          setFocusedBadge({ key: person.key, name: person.name, avatarUrl: person.avatarUrl, vip: person.totalGiftCoins > 100 || vipViewerKeys.has(person.key) });
          person.highlightUntil = Date.now() + 3500;
          person.badgeBrightAt = Date.now();
          if (person.state === 'kneeling') { person.state = 'bowing'; person.phaseUntil = Date.now() + 1000; setPose(person, 'bowing'); }
        }
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
        musicPlayer.current?.setVolume(previewMutedRef.current ? 0 : currentMusic);
        if (step >= 10 && duckTimer) clearInterval(duckTimer);
      }, 60);
    }
    async function playVoice(job: Speech): Promise<boolean> {
      if (previewMutedRef.current || !voiceAllowed || job.voiceEnabled === false) return true;
      if (job.audio) {
        try {
          audioContext ??= new AudioContext();
          if (audioContext.state !== 'running') {
            await Promise.race([
              audioContext.resume(),
              new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Audio unlock timeout')), 3000))
            ]);
          }
          if (audioContext.state !== 'running') throw new Error('Audio is suspended');
          const bytes = Uint8Array.from(atob(job.audio), character => character.charCodeAt(0));
          const buffer = await audioContext.decodeAudioData(bytes.buffer);
          const source = audioContext.createBufferSource();
          const gain = audioContext.createGain();
          source.buffer = buffer;
          gain.gain.value = previewMutedRef.current ? 0 : ttsVolume;
          source.connect(gain).connect(audioContext.destination);
          currentSource = source;
          currentGain = gain;
          await new Promise<void>(resolve => {
            const timer = setTimeout(() => { try { source.stop(); } catch { resolve(); } }, 120000);
            source.onended = () => { clearTimeout(timer); resolve(); };
            source.start();
            job.audio = undefined;
            setVoiceReady(true);
            setVoiceBlocked(false);
          });
          source.disconnect();
          gain.disconnect();
          source.buffer = null;
          if (currentSource === source) { currentSource = undefined; currentGain = undefined; }
          return true;
        } catch {
          if (audioContext?.state === 'running') job.audio = undefined;
          currentSource = undefined;
          currentGain = undefined;
          setVoiceBlocked(true);
          return false;
        }
      } else if ('speechSynthesis' in window) {
        let started = false;
        await new Promise<void>(resolve => {
          const utterance = new SpeechSynthesisUtterance(job.text);
          utterance.lang = 'vi-VN'; utterance.volume = ttsVolume; utterance.rate = ttsRate; utterance.pitch = Math.max(0, Math.min(2, 1 + ttsPitch / 10));
          const vietnameseVoice = window.speechSynthesis.getVoices().find(voice => voice.lang.toLowerCase().startsWith('vi'));
          if (vietnameseVoice) utterance.voice = vietnameseVoice;
          const startTimer = setTimeout(() => { setVoiceBlocked(true); window.speechSynthesis.cancel(); done(); }, 10000);
          const timer = setTimeout(() => { window.speechSynthesis.cancel(); done(); }, 120000);
          const done = () => { clearTimeout(startTimer); clearTimeout(timer); resolve(); };
          utterance.onstart = () => { started = true; clearTimeout(startTimer); setVoiceReady(true); setVoiceBlocked(false); };
          utterance.onend = done; utterance.onerror = () => { setVoiceBlocked(true); done(); };
          window.speechSynthesis.speak(utterance);
        });
        return started;
      }
      setVoiceBlocked(true);
      return false;
    }
    retryVoiceRef.current = () => {
      window.speechSynthesis?.cancel();
      voicePlaybackBlocked = false;
      void playSpeech();
    };
    function unlockVoice() {
      try {
        audioContext ??= new AudioContext();
        void audioContext.resume();
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        gain.gain.setValueAtTime(.0001, audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(.06, audioContext.currentTime + .02);
        gain.gain.exponentialRampToValueAtTime(.0001, audioContext.currentTime + .18);
        oscillator.frequency.value = 660;
        oscillator.connect(gain).connect(audioContext.destination);
        oscillator.start(); oscillator.stop(audioContext.currentTime + .2);
        setVoiceReady(true);
        retryVoiceRef.current?.();
      } catch { setVoiceBlocked(true); }
    }
    unlockVoiceRef.current = unlockVoice;
    async function playSpeech() {
      if (speaking) return;
      speaking = true;
      while (speechQueue.length && !disposed && !previewMutedRef.current) {
        const job = speechQueue.shift()!;
        const version = stopVersion;
        if (speechDisplayTimer) clearTimeout(speechDisplayTimer);
        setSpeech(job.text);
        duck(Math.round(musicBase * .25));
        const startedAt = Date.now();
        const played = await playVoice(job);
        if (version !== stopVersion) { setSpeech(''); continue; }
        if (!played) {
          voicePlaybackBlocked = true;
          speechQueue.splice(0, speechQueue.length, job);
          duck(musicBase);
          break;
        }
        duck(musicBase);
        speechDisplayTimer = setTimeout(() => setSpeech(''), Math.max(0, 6000 - (Date.now() - startedAt)));
      }
      speaking = false;
    }
    async function start() {
      Pixi = await import('pixi.js');
      if (disposed) return;
      const { Application, Container, Sprite, Texture, Rectangle, Assets, BlurFilter } = Pixi;
      blurFilter = new BlurFilter({ strength: 4 });
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
      app.ticker.maxFPS = 30;
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
                removePerson(person);
                continue;
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
            person.state = 'bowing'; person.phaseUntil = now + 1050; person.badgeBrightAt = now;
            setPose(person, 'bowing');
          } else if (person.state === 'bowing' && now > person.phaseUntil) {
            person.state = 'kneeling';
            setPose(person, 'kneeling');
          }
          person.body.x = person.x; person.body.y = person.y;
          const donorLevel = Math.min(1, Math.log10(person.totalGiftCoins + 1) / 4);
          person.glow.alpha = now < person.highlightUntil ? .88 + Math.sin(now / 120) * .1 : person.totalGiftCoins > 0 ? .45 + donorLevel * .48 + Math.sin(now / 700) * .05 : 0;
          person.glow.scale.set(.65 + donorLevel * .65);
          if (person.bubbleUntil && now > person.bubbleUntil) { person.label.visible = false; person.bubbleUntil = 0; }
          if (now - person.last > ttl) leave(person);
        }
        while (pendingJoins.size && people.size < maxPeople && seats.some(seat => !seat.occupied)) {
          const [key, event] = pendingJoins.entries().next().value!;
          pendingJoins.delete(key);
          spawn(event);
        }
        if (now >= nextAmbientBowAt) {
          nextAmbientBowAt = now + 10000;
          if (!reducedMotion) {
            const resting = [...people.values()].filter(person => person.state === 'kneeling');
            const count = Math.min(resting.length, Math.max(2, Math.min(4, Math.ceil(resting.length / 4))));
            for (let index = 0; index < count; index++) {
              const person = resting.splice(Math.floor(Math.random() * resting.length), 1)[0];
              person.state = 'bowing'; person.phaseUntil = now + 950; person.badgeBrightAt = now; setPose(person, 'bowing');
            }
          }
        }
        if (activeGift && now > activeGift.until) activeGift = null;
        const focus = activeGift ? people.get(activeGift.key) : undefined;
        if ((focus?.key ?? '') !== focusedKey) {
          focusedKey = focus?.key ?? '';
          setFocusedBadge(focus ? { key: focus.key, name: focus.name, avatarUrl: focus.avatarUrl, vip: focus.totalGiftCoins > 100 || vipViewerKeys.has(focus.key) } : null);
          for (const person of people.values()) person.body.filters = focusedKey && person.key !== focusedKey && blurFilter ? [blurFilter] : [];
        }
        const targetX = focus?.x ?? 450, targetY = focus ? focus.y - Math.max(130, focus.sprite.height + 25) : 800, scale = focus ? 2.35 : 1;
        camera.pivot.x += (targetX - camera.pivot.x) * .06;
        camera.pivot.y += (targetY - camera.pivot.y) * .06;
        camera.scale.x += (scale - camera.scale.x) * .06;
        camera.scale.y = camera.scale.x;
        for (const person of people.values()) {
          person.body.alpha += ((focusedKey && person.key !== focusedKey ? .42 : 1) - person.body.alpha) * .12;
          const badge = badgeRefs.current.get(person.key);
          if (!badge) continue;
          const badgeY = person.y - person.sprite.height - 18;
          const x = camera.position.x + (person.x - camera.pivot.x) * camera.scale.x;
          const y = camera.position.y + (badgeY - camera.pivot.y) * camera.scale.y;
          badge.style.left = `${x / WIDTH * 100}%`;
          badge.style.top = `${y / HEIGHT * 100}%`;
          badge.style.transform = `translate(-50%, -100%) scale(${Math.min(2.35, camera.scale.x) * .8})`;
          const fadeMs = 10000 + Math.min(50000, Math.log10(person.totalGiftCoins + 1) * 12000);
          const brightness = Math.max(0, 1 - (now - person.badgeBrightAt) / fadeMs);
          badge.style.opacity = person.state === 'leaving' || person.key === focusedKey ? '0' : String(brightness * (focusedKey ? .42 : 1));
          badge.style.zIndex = person.key === focusedKey ? '8' : '1';
          badge.style.filter = focusedKey && person.key !== focusedKey ? 'blur(2px)' : '';
        }
      });

      const token = params.get('token') ?? '';
      if (!token) { setStatus('Thiếu overlay token'); return; }
      const response = await fetch(`/api/overlay/${id}/snapshot?token=${encodeURIComponent(token)}`);
      if (disposed) return;
      if (!response.ok) { setStatus('Token không hợp lệ hoặc đã thu hồi'); return; }
      const snapshot = await response.json();
      if (disposed) return;
      liveActive = snapshot.status === 'connecting' || snapshot.status === 'connected';
      setLivePlaying(liveActive);
      maxPeople = Math.min(40, snapshot.scene?.maxCharacters ?? 40);
      ttl = (snapshot.scene?.inactiveTtlSeconds ?? 900) * 1000;
      reducedMotion = Boolean(snapshot.scene?.reducedMotion);
      fishEnabled = Boolean(snapshot.audio?.woodenFishEnabled);
      fishVolume = (snapshot.audio?.woodenFishVolume ?? 30) / 100;
      ttsVolume = (snapshot.audio?.ttsVolume ?? 80) / 100;
      voiceAllowed = snapshot.audio?.ttsEnabled !== false;
      setVoiceEnabled(voiceAllowed);
      ttsRate = snapshot.audio?.speakingRate ?? 1;
      ttsPitch = snapshot.audio?.pitch ?? 0;
      musicBase = snapshot.audio?.musicVolume ?? 30;
      currentMusic = musicBase;
      setMusicVolume(musicBase);
      setMusicUrl(snapshot.audio?.musicUrl ?? '');
      setLeaders(snapshot.leaderboard ?? []);
      for (const key of snapshot.vipViewerKeys ?? []) vipViewerKeys.add(key);
      for (const [key, coins] of Object.entries(snapshot.giftCoinsByViewer ?? {})) {
        const amount = Number(coins);
        if (Number.isFinite(amount) && amount > 0) giftCoinsByViewer.set(key, amount);
      }
      for (const viewer of snapshot.activeViewers ?? []) {
        if (people.has(viewer.userKey)) continue;
        const person = spawn({ eventId: 'restore:' + viewer.userKey, eventType: 'viewer.join', source: 'tiktok', user: { id: viewer.userKey, nickname: viewer.nickname ?? 'Phật tử', avatarUrl: viewer.avatarUrl ?? undefined }, payload: {} });
        if (person) person.last = new Date(viewer.lastSeenAt).getTime();
      }
      if (snapshot.roomStats) onEvent(snapshot.roomStats);
      socket = io(process.env.NEXT_PUBLIC_SOCKET_URL || undefined, { auth: { liveId: id, overlayToken: token } });
      socket.on('connect', () => setStatus(''));
      socket.on('disconnect', () => setStatus('Mất kết nối · đang thử lại'));
      socket.on('connect_error', () => setStatus('Không thể kết nối socket'));
      socket.on('gift.leaderboard.changed', () => {
        const request = ++leaderboardRequest;
        void fetch(`/api/overlay/${id}/snapshot?token=${encodeURIComponent(token)}`)
          .then(response => response.ok ? response.json() : Promise.reject(new Error('snapshot unavailable')))
          .then(data => {
            if (disposed || request !== leaderboardRequest) return;
            setLeaders(data.leaderboard ?? []);
            for (const key of data.vipViewerKeys ?? []) {
              vipViewerKeys.add(key);
              const person = people.get(key);
              if (person) showBadge(person);
            }
          })
          .catch(() => {});
      });
      socket.on('live.event', (event: LiveEvent) => {
        if (event.source === 'tiktok' && !liveActive) return;
        onEvent(event);
      });
      socket.on('live.status', (change: { status: string }) => {
        const wasLiveActive = liveActive;
        liveActive = change.status === 'connecting' || change.status === 'connected';
        setLivePlaying(liveActive);
        if (!liveActive && wasLiveActive) stopLiveScene();
        else { if (change.status === 'connecting') stopLiveScene(); currentMusic = musicBase; musicPlayer.current?.setVolume(previewMutedRef.current ? 0 : musicBase); }
      });
      socket.on('live.config', (change: { audio?: Record<string, unknown>; scene?: Record<string, unknown> }) => {
        if (change.scene) {
          maxPeople = Math.min(40, Number(change.scene.maxCharacters ?? maxPeople));
          ttl = Number(change.scene.inactiveTtlSeconds ?? ttl / 1000) * 1000;
          reducedMotion = Boolean(change.scene.reducedMotion);
        }
        if (change.audio) {
          fishEnabled = Boolean(change.audio.woodenFishEnabled);
          fishVolume = Number(change.audio.woodenFishVolume ?? fishVolume * 100) / 100;
          ttsVolume = Number(change.audio.ttsVolume ?? ttsVolume * 100) / 100;
          if (change.audio.ttsEnabled !== undefined) {
            voiceAllowed = Boolean(change.audio.ttsEnabled);
            setVoiceEnabled(voiceAllowed);
            if (!voiceAllowed) { try { currentSource?.stop(); } catch { /* The source already finished. */ } window.speechSynthesis?.cancel(); setVoiceBlocked(false); voicePlaybackBlocked = false; void playSpeech(); }
          }
          ttsRate = Number(change.audio.speakingRate ?? ttsRate);
          ttsPitch = Number(change.audio.pitch ?? ttsPitch);
          if (currentGain) currentGain.gain.value = previewMutedRef.current ? 0 : ttsVolume;
          musicBase = Number(change.audio.musicVolume ?? musicBase);
          currentMusic = musicBase;
          setMusicVolume(musicBase);
          setMusicUrl(String(change.audio.musicUrl ?? ''));
          musicPlayer.current?.setVolume(previewMutedRef.current || !liveActive ? 0 : musicBase);
        }
      });
      socket.on('speech.ready', (job: Speech) => {
        if (job.source === 'tiktok' && !liveActive) return;
        if (voicePlaybackBlocked) { speechQueue.splice(0, speechQueue.length, job); setSpeech(job.text); return; }
        speechQueue.splice(0, speechQueue.length, job);
        if (!previewMutedRef.current) void playSpeech();
      });
    }
    void start().catch(() => setStatus('Không tải được cảnh'));
    return () => {
      disposed = true; socket?.disconnect(); app?.destroy(true);
      window.removeEventListener('message', onPreviewAudio);
      try { currentSource?.stop(); } catch { /* The source already finished. */ }
      window.speechSynthesis?.cancel();
      if (duckTimer) clearInterval(duckTimer);
      if (speechDisplayTimer) clearTimeout(speechDisplayTimer);
      retryVoiceRef.current = null;
      unlockVoiceRef.current = null;
      void audioContext?.close();
    };
  }, [id]);

  return <main style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#18120d', display: 'grid', placeItems: 'center' }}>
    <div className={styles.frame}>
    <div ref={holder} style={{ width: '100%', height: '100%' }} />
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      {badges.map(badge => <BuddhistUserBadge key={badge.key} username={badge.name} avatarUrl={badge.avatarUrl} vip={badge.vip} elementRef={node => { if (node) badgeRefs.current.set(badge.key, node); else badgeRefs.current.delete(badge.key); }} />)}
    </div>
    {prayers.map(prayer => <div key={prayer.id} className={styles.prayer} style={{ top: `${prayer.top}%`, animationDuration: `${prayer.duration}s` }} onAnimationEnd={() => setPrayers(current => current.filter(item => item.id !== prayer.id))}>
      <span className={styles.prayerAvatar}>☸{prayer.avatarUrl && <img src={prayer.avatarUrl} alt="" referrerPolicy="no-referrer" onError={event => event.currentTarget.remove()} />}</span>
      <strong>{prayer.name}</strong><span>{prayer.text}</span>
    </div>)}
    {fallingGifts.map(gift => <div key={gift.id} className={styles.fallingGift} style={{ left: `${gift.left}%`, top: `${gift.top}%`, width: `${gift.size / WIDTH * 100}%`, animationDuration: `${gift.duration}s`, '--gift-drift': `${gift.drift}px`, '--gift-spin': `${gift.spin}deg` } as CSSProperties} onAnimationEnd={() => setFallingGifts(current => current.filter(item => item.id !== gift.id))}>
      {gift.imageUrl ? <img src={gift.imageUrl} alt={gift.name} referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = 'none'; event.currentTarget.nextElementSibling?.classList.add(styles.giftFallbackVisible); }} /> : null}
      <span className={gift.imageUrl ? styles.giftFallback : styles.giftFallbackVisible}>{gift.name}</span>
    </div>)}
    {focusedBadge && <div className={styles.focusBadge}><BuddhistUserBadge username={focusedBadge.name} avatarUrl={focusedBadge.avatarUrl} vip={focusedBadge.vip} /></div>}
    {status && <div style={{ position: 'absolute', top: 20, left: 20, padding: 10, background: '#1b140dcc', borderRadius: 10, color: '#fff' }}>{status}</div>}
    <div style={{ position: 'absolute', zIndex: 3, top: '11%', right: '2%', width: '31%', padding: '1.2%', background: '#1b140ddd', border: '1px solid #b88a46', borderRadius: 12, color: '#ffe0a0', boxSizing: 'border-box', textAlign: 'center', fontSize: '.85em' }}>
      <strong>Bảng Công Đức</strong>
      {leaders.map((leader, index) => <div key={leader.viewerKey} title={`Hạng ${index + 1}: +${leader.points} công đức · ${leader.gifts} quà`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 8 }}><span>{index + 1}.</span>{leader.avatarUrl ? <img src={leader.avatarUrl} alt="" referrerPolicy="no-referrer" style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover' }} /> : <span style={{ width: 30, height: 30, borderRadius: '50%', background: '#a46b29', display: 'grid', placeItems: 'center' }}>☸</span>}<span>+{leader.points} CĐ</span></div>)}
    </div>
    <MusicPlayer key={musicUrl} url={musicUrl} volume={previewMuted || !livePlaying ? 0 : musicVolume} playing={livePlaying && !previewMuted} playerRef={musicPlayer} />
    {speech && <div style={{ position: 'absolute', bottom: 50, left: '10%', right: '10%', padding: 20, background: '#241a12dd', color: '#fff', textAlign: 'center', borderRadius: 18 }}>{speech}</div>}
    {voiceEnabled && !previewMuted && (!voiceReady || voiceBlocked) && <button style={{ position: 'absolute', bottom: 16, right: 16, zIndex: 10 }} onClick={() => unlockVoiceRef.current?.()}>Bật giọng AI</button>}
    </div>
  </main>;
}
