"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { BattlePreview, type BattleMetadata } from "../../../../components/BattlePreview";

type Config = {
  leftAssetId: string; leftVersion: number;
  rightAssetId: string; rightVersion: number;
  backgroundAssetId: string | null; backgroundVersion: number | null;
};
type Event = { eventType: string; user?: { id?: string; uniqueId?: string; nickname?: string; avatarUrl?: string }; payload?: Record<string, unknown> };
type Fighter = { name: string; avatarUrl?: string; action: "idle" | "attack" | "hit"; since: number };
const initialFighter = (name: string): Fighter => ({ name, action: "idle", since: 0 });

function frameAt(metadata: BattleMetadata, action: Fighter["action"], elapsed: number) {
  const animation = metadata.animations[action] ?? metadata.animations.idle;
  if (!animation?.frames?.length) return Object.keys(metadata.frames)[0] ?? "";
  const total = animation.frames.reduce((sum, frame) => sum + Math.max(1, frame.durationMs), 0);
  let remaining = animation.loop ? elapsed % total : Math.min(elapsed, total - 1);
  for (const frame of animation.frames) {
    remaining -= Math.max(1, frame.durationMs);
    if (remaining < 0) return frame.frameId;
  }
  return animation.frames.at(-1)!.frameId;
}

export default function BattleLiveOverlay({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [token, setToken] = useState("");
  const [config, setConfig] = useState<Config | null>(null);
  const [metadata, setMetadata] = useState<Record<string, BattleMetadata>>({});
  const [fighters, setFighters] = useState<[Fighter, Fighter]>([initialFighter("Đấu sĩ trái"), initialFighter("Đấu sĩ phải")]);
  const [now, setNow] = useState(0);
  const [status, setStatus] = useState("Đang kết nối…");
  const [error, setError] = useState("");
  const viewers = useRef(new Map<string, number>());
  const nextSide = useRef(0);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setToken(new URLSearchParams(window.location.search).get("token") ?? ""), []);
  useEffect(() => {
    if (!token) { setError("Thiếu token Battle OBS. Tạo URL trong trang Battle Arena."); return; }
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/overlay/${id}/battle-config?token=${encodeURIComponent(token)}`, { cache: "no-store" });
        if (!response.ok) throw new Error(response.status === 401 ? "Token Battle không hợp lệ hoặc đã bị thu hồi." : `Không tải được cấu hình Battle (${response.status}).`);
        const value = await response.json() as Config | { configured: false };
        if (!("leftAssetId" in value)) throw new Error("LIVE này chưa gắn nhân vật Battle.");
        const pairs = [[value.leftAssetId, value.leftVersion], [value.rightAssetId, value.rightVersion]] as const;
        const entries = await Promise.all(pairs.map(async ([assetId, version]) => {
          const url = `/api/battle-assets/${assetId}/file/metadata.json?version=${version}&liveId=${id}&token=${encodeURIComponent(token)}`;
          const result = await fetch(url, { cache: "no-store" });
          if (!result.ok) throw new Error(`Không tải được nhân vật Battle (${result.status}).`);
          return [assetId, await result.json() as BattleMetadata] as const;
        }));
        if (active) { setConfig(value); setMetadata(Object.fromEntries(entries)); setError(""); }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : String(cause)); }
    })();
    return () => { active = false; };
  }, [id, token]);
  useEffect(() => {
    if (!config || !token) return;
    const socket = io({ path: "/socket.io", auth: { liveId: id, overlayToken: token } });
    socket.on("connect", () => setStatus("Đã nối LIVE · chờ sự kiện TikTok"));
    socket.on("connect_error", () => setStatus("Mất kết nối LIVE"));
    socket.on("live.status", (value: { status: string }) => setStatus(`TikTok: ${value.status}`));
    socket.on("live.event", (event: Event) => {
      const key = event.user?.id ?? event.user?.uniqueId;
      if (event.eventType === "viewer.join" && key) {
        const side = viewers.current.get(key) ?? nextSide.current;
        viewers.current.set(key, side);
        nextSide.current = 1 - side;
        setFighters(current => current.map((fighter, index) => index === side
          ? { ...fighter, name: event.user?.nickname || key, avatarUrl: event.user?.avatarUrl }
          : fighter) as [Fighter, Fighter]);
      }
      if (event.eventType === "viewer.leave" && key) viewers.current.delete(key);
      if (event.eventType === "gift.received" && event.payload?.repeatEnd !== false) {
        const side = key ? viewers.current.get(key) ?? nextSide.current : nextSide.current;
        if (key) viewers.current.set(key, side);
        nextSide.current = 1 - side;
        const time = Date.now();
        setFighters(current => current.map((fighter, index) => index === side
          ? { ...fighter, name: event.user?.nickname || fighter.name, avatarUrl: event.user?.avatarUrl ?? fighter.avatarUrl, action: "attack", since: time }
          : { ...fighter, action: "hit", since: time }) as [Fighter, Fighter]);
        if (resetTimer.current) clearTimeout(resetTimer.current);
        resetTimer.current = setTimeout(() => setFighters(current => current.map(fighter => ({ ...fighter, action: "idle", since: Date.now() })) as [Fighter, Fighter]), 900);
      }
    });
    const clock = setInterval(() => setNow(Date.now()), 70);
    return () => { socket.disconnect(); clearInterval(clock); if (resetTimer.current) clearTimeout(resetTimer.current); };
  }, [config, id, token]);
  const characters = useMemo(() => {
    if (!config) return [];
    return ([config.leftAssetId, config.rightAssetId] as const).flatMap((assetId, side) => {
      const data = metadata[assetId];
      if (!data) return [];
      const fighter = fighters[side];
      const version = side ? config.rightVersion : config.leftVersion;
      const query = `version=${version}&liveId=${id}&token=${encodeURIComponent(token)}`;
      return [{
        atlasUrl: `/api/battle-assets/${assetId}/file/atlas.png?${query}`,
        metadata: data,
        frameId: frameAt(data, fighter.action, Math.max(0, now - fighter.since)),
        x: side ? 380 : 160, y: 730, scale: 0.5, flipX: !!side,
        avatarUrl: fighter.avatarUrl, label: fighter.name,
      }];
    });
  }, [config, metadata, fighters, id, token, now]);
  const backgroundUrl = config?.backgroundAssetId && config.backgroundVersion
    ? `/api/battle-assets/${config.backgroundAssetId}/file/background?version=${config.backgroundVersion}&liveId=${id}&token=${encodeURIComponent(token)}`
    : undefined;
  return <main style={{ minHeight: "100vh", background: "#101522", color: "white", textAlign: "center" }}>
    {error ? <p role="alert">{error}</p> : <>
      <div style={{ width: "min(100vw, 54vh, 540px)", margin: "auto" }}>
        <BattlePreview characters={characters} backgroundUrl={backgroundUrl} groundY={730} />
      </div>
      <p role="status">{status}</p>
    </>}
  </main>;
}
