"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  BattlePreview,
  type BattleMetadata,
} from "../../../../../../components/BattlePreview";

type Version = {
  version: number;
  status: string;
  atlasKey: string | null;
  metadata: Record<string, unknown>;
};
type Asset = { id: string; name: string; kind: string; versions: Version[] };
type Mode = "single" | "direction" | "combat" | "obs" | "stress";
function frameAt(
  meta: BattleMetadata,
  animation: string,
  time: number,
  loop: boolean,
  speed: number,
) {
  const data = meta.animations[animation];
  if (!data?.frames?.length) return Object.keys(meta.frames)[0] ?? "";
  const total = data.frames.reduce((n, f) => n + f.durationMs, 0);
  let cursor =
    loop && total
      ? (time * speed) % total
      : Math.min(time * speed, Math.max(0, total - 1));
  for (const f of data.frames) {
    if (cursor < f.durationMs) return f.frameId;
    cursor -= f.durationMs;
  }
  return data.frames.at(-1)?.frameId ?? "";
}
export default function Simulator() {
  const { characterId } = useParams<{ characterId: string }>();
  const [asset, setAsset] = useState<Asset | null>(null),
    [others, setOthers] = useState<Asset[]>([]),
    [meta, setMeta] = useState<BattleMetadata | null>(null),
    [opponentMeta, setOpponentMeta] = useState<BattleMetadata | null>(null),
    [opponent, setOpponent] = useState(""),
    [background, setBackground] = useState(""),
    [mode, setMode] = useState<Mode>("single"),
    [animation, setAnimation] = useState("idle"),
    [playing, setPlaying] = useState(false),
    [elapsed, setElapsed] = useState(0),
    [speed, setSpeed] = useState(1),
    [loop, setLoop] = useState(true),
    [zoom, setZoom] = useState(1),
    [flip, setFlip] = useState(false),
    [pivot, setPivot] = useState(false),
    [hitbox, setHitbox] = useState(false),
    [hurtbox, setHurtbox] = useState(false),
    [ground, setGround] = useState(true),
    [x, setX] = useState(270),
    [anchorY, setAnchorY] = useState(730),
    [error, setError] = useState("");
  useEffect(() => {
    void (async () => {
      try {
        const [a, list] = await Promise.all([
          fetch(`/api/battle-assets/${characterId}`).then((r) =>
            r.json(),
          ) as Promise<Asset>,
          fetch("/api/battle-assets").then((r) => r.json()) as Promise<Asset[]>,
        ]);
        setAsset(a);
        setOthers(list);
        const v = a.versions[0];
        if (v?.atlasKey) {
          const r = await fetch(
            `/api/battle-assets/${a.id}/file/metadata.json?version=${v.version}`,
          );
          if (r.ok) setMeta((await r.json()) as BattleMetadata);
        } else setError("Chưa có atlas. Lưu và xử lý sprite ở Frame Editor.");
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [characterId]);
  useEffect(() => {
    if (!opponent) {
      setOpponentMeta(null);
      return;
    }
    const a = others.find((x) => x.id === opponent),
      v = a?.versions[0];
    if (!a || !v) return;
    void fetch(
      `/api/battle-assets/${a.id}/file/metadata.json?version=${v.version}`,
    )
      .then((r) => r.json())
      .then((x) => setOpponentMeta(x as BattleMetadata))
      .catch(() => setOpponentMeta(null));
  }, [opponent, others]);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      setElapsed((t) => t + (now - last));
      last = now;
    }, 33);
    return () => window.clearInterval(id);
  }, [playing]);
  const activeVersion = asset?.versions[0];
  const opponentAsset = others.find((x) => x.id === opponent);
  const opponentVersion = opponentAsset?.versions[0];
  const frame = meta ? frameAt(meta, animation, elapsed, loop, speed) : "";
  const phase = elapsed % 5000;
  const directionX =
    mode === "direction"
      ? x + Math.sin(elapsed / 650) * 120
      : mode === "combat"
        ? 110 + Math.min(140, phase / 10)
        : x;
  const combatAnimation =
    mode === "combat"
      ? phase < 1500
        ? "walk_right"
        : phase < 2800
          ? "attack"
          : phase < 3400
            ? "hit"
            : phase < 3900
              ? "fall"
              : "die"
      : animation;
  const characters = useMemo(() => {
    if (!meta || !asset || !activeVersion) return [];
    const primary = {
      atlasUrl: `/api/battle-assets/${asset.id}/file/atlas.png?version=${activeVersion.version}`,
      metadata: meta,
      frameId: frameAt(meta, combatAnimation, elapsed, loop, speed),
      x: directionX,
      y: anchorY,
      scale: 0.55,
      flipX: flip,
    };
    if (mode === "stress")
      return Array.from({ length: 12 }, (_, i) => ({
        ...primary,
        x: 70 + (i % 4) * 130,
        y: 400 + Math.floor(i / 4) * 180,
        scale: 0.22,
      }));
    if (mode === "combat" && opponentMeta && opponentAsset && opponentVersion)
      return [
        primary,
        {
          atlasUrl: `/api/battle-assets/${opponentAsset.id}/file/atlas.png?version=${opponentVersion.version}`,
          metadata: opponentMeta,
          frameId: frameAt(
            opponentMeta,
            phase < 1500
              ? "walk_left"
              : phase < 2800
                ? "idle"
                : phase < 3400
                  ? "hit"
                  : phase < 3900
                    ? "fall"
                    : "die",
            elapsed,
            loop,
            speed,
          ),
          x: 430 - Math.min(140, phase / 10),
          y: anchorY,
          scale: 0.55,
          flipX: true,
        },
      ];
    return [primary];
  }, [
    meta,
    asset,
    activeVersion,
    combatAnimation,
    elapsed,
    loop,
    speed,
    directionX,
    anchorY,
    flip,
    mode,
    opponentMeta,
    opponentAsset,
    opponentVersion,
    phase,
  ]);
  const frames = meta?.animations[animation]?.frames ?? [];
  const currentIndex = frames.findIndex((f) => f.frameId === frame);
  function step(delta: number) {
    if (!frames.length) return;
    const next = Math.max(0, Math.min(frames.length - 1, currentIndex + delta));
    setPlaying(false);
    setElapsed(
      frames.slice(0, next).reduce((n, f) => n + f.durationMs, 0) / speed + 1,
    );
  }
  return (
    <main className="shell">
      <a href="/admin/battle-assets">← Sprite Studio</a>
      <h1>Sprite Simulator · {asset?.name ?? "Đang tải"}</h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="split">
        <section className="card stack" style={{ minWidth: 300 }}>
          <label>
            Chế độ
            <select
              value={mode}
              onChange={(e) => {
                setMode(e.target.value as Mode);
                setElapsed(0);
              }}
            >
              <option value="single">Single Animation</option>
              <option value="direction">Direction Test</option>
              <option value="combat">Combat Test</option>
              <option value="obs">9:16 OBS Preview</option>
              <option value="stress">Stress Test</option>
            </select>
          </label>
          <label>
            Animation
            <select
              value={animation}
              onChange={(e) => {
                setAnimation(e.target.value);
                setElapsed(0);
              }}
            >
              {Object.keys(meta?.animations ?? {}).map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
          <div className="row">
            <button onClick={() => setPlaying(true)}>Play</button>
            <button onClick={() => setPlaying(false)}>Pause</button>
            <button
              onClick={() => {
                setPlaying(false);
                setElapsed(0);
              }}
            >
              Stop
            </button>
            <button
              onClick={() => {
                setElapsed(0);
                setPlaying(true);
              }}
            >
              Restart
            </button>
            <button onClick={() => step(-1)}>← Frame</button>
            <button onClick={() => step(1)}>Frame →</button>
          </div>
          <label>
            <input
              type="checkbox"
              checked={loop}
              onChange={(e) => setLoop(e.target.checked)}
            />{" "}
            Loop
          </label>
          <label>
            Tốc độ
            <input
              type="range"
              min="0.1"
              max="4"
              step="0.1"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            />
            {speed}×
          </label>
          <label>
            Zoom
            <input
              type="range"
              min=".25"
              max="3"
              step=".05"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
            {zoom}×
          </label>
          <label>
            Vị trí X
            <input
              type="range"
              min="0"
              max="540"
              value={x}
              onChange={(e) => setX(Number(e.target.value))}
            />
          </label>
          <label>
            Anchor Y
            <input
              type="range"
              min="300"
              max="900"
              value={anchorY}
              onChange={(e) => setAnchorY(Number(e.target.value))}
            />
          </label>
          {(["flip", "pivot", "hitbox", "hurtbox", "ground"] as const).map(
            (key) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={{ flip, pivot, hitbox, hurtbox, ground }[key]}
                  onChange={(e) =>
                    ({
                      flip: setFlip,
                      pivot: setPivot,
                      hitbox: setHitbox,
                      hurtbox: setHurtbox,
                      ground: setGround,
                    })[key](e.target.checked)
                  }
                />
                {key}
              </label>
            ),
          )}
          <label>
            Background
            <select
              value={background}
              onChange={(e) => setBackground(e.target.value)}
            >
              <option value="">Màu tối</option>
              {others
                .filter(
                  (a) =>
                    a.kind === "BACKGROUND" &&
                    a.versions.some((v) => v.status === "PUBLISHED"),
                )
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>
          {mode === "combat" && (
            <label>
              Đối thủ
              <select
                value={opponent}
                onChange={(e) => setOpponent(e.target.value)}
              >
                <option value="">Chọn nhân vật</option>
                {others
                  .filter(
                    (a) =>
                      a.kind === "SPRITE" &&
                      a.id !== asset?.id &&
                      a.versions[0]?.atlasKey,
                  )
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <p>
            Frame: {frame || "—"} · FPS preview: {playing ? 30 : 0}
          </p>
          <p className="muted">
            Combat ở đây chỉ là minh họa hoạt hình; HP và damage thực tế phải do
            Battle Engine backend xác nhận.
          </p>
        </section>
        <section className="card" style={{ flex: 1 }}>
          <div style={{ position: "relative", maxWidth: 540, margin: "auto" }}>
            <BattlePreview
              characters={characters}
              backgroundUrl={
                background
                  ? `/api/battle-assets/${background}/file/background`
                  : undefined
              }
              showPivot={pivot}
              showHitbox={hitbox}
              showHurtbox={hurtbox}
              showGround={ground}
              groundY={anchorY}
              zoom={zoom}
            />
            {mode === "obs" && (
              <div
                style={{
                  position: "absolute",
                  top: 20,
                  left: 20,
                  right: 20,
                  display: "flex",
                  justifyContent: "space-between",
                  color: "#fff",
                  textShadow: "0 2px 2px #000",
                }}
              >
                <span>🟥 HP 100/100</span>
                <span>🟦 HP 100/100</span>
              </div>
            )}
          </div>
          <button
            onClick={(e) => e.currentTarget.parentElement?.requestFullscreen()}
          >
            Toàn màn hình
          </button>
        </section>
      </div>
      <section className="card">
        <h2>Quality checklist</h2>
        <ul>
          {[
            "idle",
            "walk_left",
            "walk_right",
            "attack",
            "hit",
            "fall",
            "die",
          ].map((name) => (
            <li key={name}>
              {meta?.animations[name]?.frames.length ? "✓" : "⚠"} {name}:{" "}
              {meta?.animations[name]?.frames.length ?? 0} frame
            </li>
          ))}
        </ul>
        <p>
          {meta?.animations.die?.holdLastFrame
            ? "✓ Die giữ frame cuối"
            : "⚠ Die cần giữ frame cuối"}
        </p>
        <p>
          {Object.values(meta?.animations ?? {}).some((a) =>
            a.frames.some((f) => f.events?.includes("attack.visual-impact")),
          )
            ? "✓ Có mốc va chạm"
            : "⚠ Thiếu event attack.visual-impact"}
        </p>
        <p className="muted">
          Crop, vũ khí, tỷ lệ, pivot và nền trong suốt cần admin xem trực tiếp.
        </p>
      </section>
    </main>
  );
}
