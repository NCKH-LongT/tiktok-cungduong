"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

type Box = { x: number; y: number; width: number; height: number };
type Frame = {
  id: string;
  crop: Box;
  padding: number;
  pivot: { x: number; y: number };
  footAnchor: { x: number; y: number };
  headAnchor: { x: number; y: number };
  hitbox?: Box;
  hurtbox?: Box;
  collisionBox?: Box;
  mask?: {
    color?: [number, number, number];
    threshold?: number;
    feather?: number;
    strokes?: {
      x: number;
      y: number;
      radius: number;
      mode: "erase" | "restore";
    }[];
  };
};
type Animation = {
  loop: boolean;
  speed: number;
  direction: "left" | "right" | "none";
  allowFlipX: boolean;
  holdLastFrame: boolean;
  priority: number;
  rootMotion: { x: number; y: number };
  transitions: string[];
  frames: { frameId: string; durationMs: number; events: string[] }[];
};
type SpriteDraft = {
  canvas: { width: number; height: number };
  frames: Frame[];
  animations: Record<string, Animation>;
  character: {
    code: string;
    name: string;
    element: string;
    color: string;
    spawnSide: "left" | "right";
  };
};
type BackgroundDraft = {
  fit: "contain" | "cover" | "custom";
  brightness: number;
  contrast: number;
  opacity: number;
  scale: number;
  x: number;
  y: number;
  groundZones: { left: number; right: number; y: number }[];
  bounds: { left: number; right: number };
  uiSafeZones: Box[];
};
type Asset = {
  id: string;
  kind: "SPRITE" | "BACKGROUND";
  name: string;
  width: number;
  height: number;
  status: string;
  versions: {
    id: string;
    version: number;
    status: string;
    metadata: Record<string, unknown>;
    atlasKey: string | null;
    publishedAt: string | null;
    validations?: { passed: boolean; warnings: string[] }[];
  }[];
  character?: { code: string; activeVersionId: string } | null;
  background?: { activeVersionId: string; isActive: boolean } | null;
};
const tabs = [
  "Background Manager",
  "Character Library",
  "Sprite Importer",
  "Frame Editor",
  "Animation Editor",
  "Sprite Simulator",
  "Published Assets",
] as const;
const actions = [
  "idle",
  "walk_left",
  "walk_right",
  "run_left",
  "run_right",
  "attack",
  "combo1",
  "combo2",
  "skill_q",
  "skill_w",
  "skill_e",
  "skill_r",
  "hit",
  "fall",
  "die",
];
const blankAnimation = (): Animation => ({
  loop: true,
  speed: 1,
  direction: "none",
  allowFlipX: false,
  holdLastFrame: false,
  priority: 0,
  rootMotion: { x: 0, y: 0 },
  transitions: [],
  frames: [],
});
const blankBackground = (): BackgroundDraft => ({
  fit: "cover",
  brightness: 1,
  contrast: 1,
  opacity: 1,
  scale: 1,
  x: 0,
  y: 0,
  groundZones: [{ left: 100, right: 980, y: 1450 }],
  bounds: { left: 80, right: 1000 },
  uiSafeZones: [],
});
const deep = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const originalUrl = (id: string) => `/api/battle-assets/${id}/file/original`;
async function api(url: string, init?: RequestInit) {
  const r = await fetch(`/api/battle-assets${url}`, {
    cache: "no-store",
    ...init,
  });
  if (!r.ok) {
    let message = `HTTP ${r.status}`;
    try {
      message = ((await r.json()) as { error?: string }).error ?? message;
    } catch {}
    throw new Error(message);
  }
  return r.json();
}

export default function BattleAssetsPage() {
  const [tab, setTab] = useState<(typeof tabs)[number]>("Background Manager");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<SpriteDraft | BackgroundDraft | null>(
    null,
  );
  const [selectedFrame, setSelectedFrame] = useState("");
  const [mergeTarget, setMergeTarget] = useState("");
  const [animationName, setAnimationName] = useState("idle");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [showPivot, setShowPivot] = useState(true);
  const [showHitbox, setShowHitbox] = useState(true);
  const [showHurtbox, setShowHurtbox] = useState(true);
  const [maskMode, setMaskMode] = useState<"move" | "erase" | "restore">(
    "move",
  );
  const [history, setHistory] = useState<(SpriteDraft | BackgroundDraft)[]>([]);
  const [future, setFuture] = useState<(SpriteDraft | BackgroundDraft)[]>([]);
  const imageRef = useRef<HTMLImageElement>(null);
  const selected = assets.find((a) => a.id === selectedId);
  const version = selected?.versions[0];
  const sprite = draft && "frames" in draft ? draft : null;
  const background = draft && "groundZones" in draft ? draft : null;
  const frame = sprite?.frames.find((f) => f.id === selectedFrame);
  const reload = useCallback(async () => {
    const rows = (await api("")) as Asset[];
    setAssets(rows);
    setSelectedId((id) => id || rows[0]?.id || "");
  }, []);
  useEffect(() => {
    void reload().catch((e) => setError(String(e)));
  }, [reload]);
  useEffect(() => {
    if (!selected) {
      setDraft(null);
      return;
    }
    const data = selected.versions[0]?.metadata ?? {};
    if (selected.kind === "BACKGROUND")
      setDraft({ ...blankBackground(), ...data } as BackgroundDraft);
    else {
      const inspection = (data.inspection ?? {}) as { candidates?: Box[] };
      setDraft(
        ("frames" in data
          ? data
          : {
              canvas: { width: 512, height: 512 },
              frames: (inspection.candidates ?? [])
                .slice(0, 150)
                .map((c, i) => ({
                  id: `frame_${String(i + 1).padStart(3, "0")}`,
                  crop: { x: c.x, y: c.y, width: c.width, height: c.height },
                  padding: 8,
                  pivot: { x: 0.5, y: 1 },
                  footAnchor: { x: 0.5, y: 1 },
                  headAnchor: { x: 0.5, y: 0.1 },
                })),
              animations: {},
              character: {
                code:
                  selected.name
                    .toLowerCase()
                    .replace(/[^a-z0-9_-]/g, "")
                    .slice(0, 30) || `asset_${selected.id.slice(0, 8)}`,
                name: selected.name,
                element: "unassigned",
                color: "unassigned",
                spawnSide: "left",
              },
            }) as SpriteDraft,
      );
    }
    setHistory([]);
    setFuture([]);
    setSelectedFrame("");
  }, [selectedId, selected?.versions[0]?.id, selected?.versions[0]?.status]);
  function change<T extends SpriteDraft | BackgroundDraft>(next: T) {
    if (draft) setHistory((h) => [...h.slice(-29), deep(draft)]);
    setFuture([]);
    setDraft(next);
  }
  function undo() {
    if (!history.length || !draft) return;
    setFuture((f) => [deep(draft), ...f]);
    setDraft(history.at(-1)!);
    setHistory((h) => h.slice(0, -1));
  }
  function redo() {
    if (!future.length || !draft) return;
    setHistory((h) => [...h, deep(draft)]);
    setDraft(future[0]);
    setFuture((f) => f.slice(1));
  }
  async function perform(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await reload();
      setNotice(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function upload(kind: "SPRITE" | "BACKGROUND", file: File | null) {
    if (!file) return;
    const name = window.prompt(
      "Tên tài nguyên",
      file.name.replace(/\.[^.]+$/, ""),
    );
    if (!name) return;
    await perform(async () => {
      const result = await api(
        `/upload?kind=${kind}&name=${encodeURIComponent(name)}`,
        {
          method: "POST",
          headers: { "content-type": "application/octet-stream" },
          body: file,
        },
      );
      setSelectedId((result as Asset).id);
    }, "Đã upload. Worker đang phân tích ảnh; bấm Làm mới để xem đề xuất.");
  }
  function editFrame(next: Frame) {
    if (!sprite) return;
    change({
      ...sprite,
      frames: sprite.frames.map((f) => (f.id === next.id ? next : f)),
    });
  }
  function editBox(
    key: "crop" | "hitbox" | "hurtbox" | "collisionBox",
    field: keyof Box,
    value: number,
  ) {
    if (!frame) return;
    editFrame({
      ...frame,
      [key]: {
        ...(frame[key] ?? { x: 0, y: 0, width: 50, height: 50 }),
        [field]: value,
      },
    });
  }
  function dragProperty(
    event: ReactPointerEvent<HTMLSpanElement>,
    key: "pivot" | "hitbox" | "hurtbox",
  ) {
    if (!frame || !sprite) return;
    const old = deep(frame);
    const startX = event.clientX,
      startY = event.clientY,
      target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    target.onpointermove = (move) => {
      const dx = ((move.clientX - startX) * sprite.canvas.width) / 240;
      const dy = ((move.clientY - startY) * sprite.canvas.height) / 240;
      if (key === "pivot")
        editFrame({
          ...old,
          pivot: {
            x: Math.max(0, Math.min(1, old.pivot.x + dx / sprite.canvas.width)),
            y: Math.max(
              0,
              Math.min(1, old.pivot.y + dy / sprite.canvas.height),
            ),
          },
        });
      else {
        const box = old[key];
        if (box)
          editFrame({
            ...old,
            [key]: {
              ...box,
              x: Math.round(box.x + dx),
              y: Math.round(box.y + dy),
            },
          });
      }
    };
    target.onpointerup = () => {
      target.onpointermove = null;
      target.onpointerup = null;
    };
  }
  function paintMask(clientX: number, clientY: number) {
    if (!frame || !selected || maskMode === "move" || !imageRef.current) return;
    const rect = imageRef.current.getBoundingClientRect();
    const sourceX = ((clientX - rect.left) * selected.width) / rect.width,
      sourceY = ((clientY - rect.top) * selected.height) / rect.height;
    if (
      sourceX < frame.crop.x ||
      sourceY < frame.crop.y ||
      sourceX > frame.crop.x + frame.crop.width ||
      sourceY > frame.crop.y + frame.crop.height
    )
      return;
    editFrame({
      ...frame,
      mask: {
        ...frame.mask,
        threshold: frame.mask?.threshold ?? 35,
        strokes: [
          ...(frame.mask?.strokes ?? []).slice(-498),
          {
            x: Math.round(sourceX - frame.crop.x),
            y: Math.round(sourceY - frame.crop.y),
            radius: 12,
            mode: maskMode,
          },
        ],
      },
    });
  }
  function moveFrame(index: number, delta: number) {
    if (!sprite || index + delta < 0 || index + delta >= sprite.frames.length)
      return;
    const frames = [...sprite.frames];
    [frames[index], frames[index + delta]] = [
      frames[index + delta],
      frames[index],
    ];
    change({ ...sprite, frames });
  }
  function splitFrame(axis: "x" | "y") {
    if (!sprite || !frame || frame.crop[axis === "x" ? "width" : "height"] < 2)
      return;
    const first = deep(frame),
      second = deep(frame),
      sizeKey = axis === "x" ? "width" : "height",
      firstSize = Math.floor(frame.crop[sizeKey] / 2);
    first.crop[sizeKey] = firstSize;
    second.crop[axis] += firstSize;
    second.crop[sizeKey] -= firstSize;
    second.id = `${frame.id}_${Date.now().toString(36)}`;
    change({
      ...sprite,
      frames: sprite.frames.flatMap((item) =>
        item.id === frame.id ? [first, second] : [item],
      ),
    });
  }
  function mergeFrames() {
    if (!sprite || !frame || !mergeTarget || mergeTarget === frame.id) return;
    const other = sprite.frames.find((item) => item.id === mergeTarget);
    if (!other) return;
    const x = Math.min(frame.crop.x, other.crop.x),
      y = Math.min(frame.crop.y, other.crop.y),
      right = Math.max(
        frame.crop.x + frame.crop.width,
        other.crop.x + other.crop.width,
      ),
      bottom = Math.max(
        frame.crop.y + frame.crop.height,
        other.crop.y + other.crop.height,
      );
    change({
      ...sprite,
      frames: sprite.frames
        .filter((item) => item.id !== other.id)
        .map((item) =>
          item.id === frame.id
            ? { ...item, crop: { x, y, width: right - x, height: bottom - y } }
            : item,
        ),
      animations: Object.fromEntries(
        Object.entries(sprite.animations).map(([name, animation]) => [
          name,
          {
            ...animation,
            frames: animation.frames.map((item) =>
              item.frameId === other.id ? { ...item, frameId: frame.id } : item,
            ),
          },
        ]),
      ),
    });
    setMergeTarget("");
  }
  function editAnimation(next: Animation) {
    if (!sprite) return;
    change({
      ...sprite,
      animations: { ...sprite.animations, [animationName]: next },
    });
  }
  const anim = sprite?.animations[animationName];
  return (
    <main className="shell" style={{ maxWidth: 1500 }}>
      <a href="/admin">← Quản trị</a>
      <h1>Battle Arena · Sprite Studio</h1>
      <p className="muted">
        Ảnh upload chỉ là bản nháp. Admin cần kiểm tra từng frame, animation và
        preview trước khi duyệt.
      </p>
      <nav
        className="row"
        style={{ flexWrap: "wrap", gap: 8, marginBottom: 20 }}
      >
        {tabs.map((x) => (
          <button key={x} onClick={() => setTab(x)} aria-pressed={tab === x}>
            {x}
          </button>
        ))}
      </nav>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div
        className="row"
        style={{ gap: 12, flexWrap: "wrap", marginBottom: 16 }}
      >
        <label>
          Tài nguyên{" "}
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            <option value="">Chọn…</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.kind} · {a.status}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => void reload()} disabled={busy}>
          Làm mới
        </button>
        {selected && (
          <span>
            Phiên bản {version?.version} · {version?.status}
          </span>
        )}
      </div>
      {tab === "Background Manager" && (
        <section className="card">
          <h2>Background 9:16</h2>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) =>
              void upload("BACKGROUND", e.target.files?.[0] ?? null)
            }
          />
          {selected?.kind === "BACKGROUND" && background && (
            <div className="split">
              <div
                style={{
                  width: 300,
                  aspectRatio: "9/16",
                  overflow: "hidden",
                  background: "#111",
                  position: "relative",
                }}
              >
                <img
                  src={originalUrl(selected.id)}
                  alt="Preview background"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit:
                      background.fit === "custom" ? "cover" : background.fit,
                    filter: `brightness(${background.brightness}) contrast(${background.contrast})`,
                    opacity: background.opacity,
                    transform: `translate(${(background.x / 1080) * 300}px,${(background.y / 1920) * 533}px) scale(${background.scale})`,
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    top: `${((background.groundZones[0]?.y ?? 1440) / 1920) * 100}%`,
                    left: 0,
                    right: 0,
                    borderTop: "2px dashed yellow",
                  }}
                />
              </div>
              <div className="stack">
                {(
                  [
                    "fit",
                    "brightness",
                    "contrast",
                    "opacity",
                    "scale",
                    "x",
                    "y",
                  ] as const
                ).map((k) => (
                  <label key={k}>
                    {k}
                    {k === "fit" ? (
                      <select
                        value={background.fit}
                        onChange={(e) =>
                          change({
                            ...background,
                            fit: e.target.value as BackgroundDraft["fit"],
                          })
                        }
                      >
                        <option>contain</option>
                        <option>cover</option>
                        <option>custom</option>
                      </select>
                    ) : (
                      <input
                        type="number"
                        step="0.05"
                        value={background[k]}
                        onChange={(e) =>
                          change({ ...background, [k]: Number(e.target.value) })
                        }
                      />
                    )}
                  </label>
                ))}
                <h3>Vùng mặt sàn (canvas 1080 × 1920)</h3>
                {background.groundZones.map((z, i) => (
                  <div className="row" key={i}>
                    {(["left", "right", "y"] as const).map((k) => (
                      <label key={k}>
                        {k}
                        <input
                          type="number"
                          value={z[k]}
                          onChange={(e) => {
                            const zones = deep(background.groundZones);
                            zones[i][k] = Number(e.target.value);
                            change({ ...background, groundZones: zones });
                          }}
                        />
                      </label>
                    ))}
                    <button
                      onClick={() =>
                        change({
                          ...background,
                          groundZones: background.groundZones.filter(
                            (_, n) => n !== i,
                          ),
                        })
                      }
                    >
                      Xóa
                    </button>
                  </div>
                ))}
                <button
                  onClick={() =>
                    change({
                      ...background,
                      groundZones: [
                        ...background.groundZones,
                        { left: 0, right: 1080, y: 1450 },
                      ],
                    })
                  }
                >
                  Thêm vùng sàn
                </button>
                <label>
                  Biên trái
                  <input
                    type="number"
                    value={background.bounds.left}
                    onChange={(e) =>
                      change({
                        ...background,
                        bounds: {
                          ...background.bounds,
                          left: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
                <label>
                  Biên phải
                  <input
                    type="number"
                    value={background.bounds.right}
                    onChange={(e) =>
                      change({
                        ...background,
                        bounds: {
                          ...background.bounds,
                          right: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
                <h3>Khu vực UI an toàn</h3>
                {background.uiSafeZones.map((z, i) => (
                  <div className="row" key={i}>
                    {(["x", "y", "width", "height"] as const).map((k) => (
                      <label key={k}>
                        {k}
                        <input
                          type="number"
                          value={z[k]}
                          onChange={(e) => {
                            const zones = deep(background.uiSafeZones);
                            zones[i][k] = Number(e.target.value);
                            change({ ...background, uiSafeZones: zones });
                          }}
                        />
                      </label>
                    ))}
                    <button
                      onClick={() =>
                        change({
                          ...background,
                          uiSafeZones: background.uiSafeZones.filter(
                            (_, n) => n !== i,
                          ),
                        })
                      }
                    >
                      Xóa
                    </button>
                  </div>
                ))}
                <button
                  onClick={() =>
                    change({
                      ...background,
                      uiSafeZones: [
                        ...background.uiSafeZones,
                        { x: 0, y: 0, width: 1080, height: 200 },
                      ],
                    })
                  }
                >
                  Thêm vùng UI
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void perform(
                      () =>
                        api(`/${selected.id}/draft`, {
                          method: "PUT",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify(background),
                        }),
                      "Đã lưu background nháp",
                    )
                  }
                >
                  Lưu nháp
                </button>
              </div>
            </div>
          )}
        </section>
      )}
      {tab === "Character Library" && (
        <section className="card">
          <h2>Thư viện nhân vật</h2>
          {assets
            .filter((a) => a.kind === "SPRITE")
            .map((a) => (
              <div
                className="row"
                key={a.id}
                style={{ padding: 10, borderBottom: "1px solid #665" }}
              >
                <button onClick={() => setSelectedId(a.id)}>{a.name}</button>
                <span>
                  {a.width} × {a.height} · {a.status}
                </span>
                {a.character && <span>{a.character.code}</span>}
              </div>
            ))}
        </section>
      )}
      {tab === "Sprite Importer" && (
        <section className="card">
          <h2>Import sprite PNG</h2>
          <input
            type="file"
            accept="image/png"
            onChange={(e) => void upload("SPRITE", e.target.files?.[0] ?? null)}
          />
          {selected?.kind === "SPRITE" && (
            <>
              <p>
                Ảnh nguồn {selected.width} × {selected.height}. Phát hiện tự
                động chỉ đề xuất vùng; cần bỏ nhãn và hiệu ứng không thuộc
                frame.
              </p>
              <img
                src={originalUrl(selected.id)}
                alt="Sprite sheet nguồn"
                style={{ maxWidth: "100%", maxHeight: 450 }}
              />
              <p>
                Đề xuất:{" "}
                {
                  (
                    (
                      version?.metadata?.inspection as
                        | { candidates?: unknown[] }
                        | undefined
                    )?.candidates ?? []
                  ).length
                }{" "}
                vùng · {sprite?.frames.length ?? 0} frame nháp.
              </p>
              <button onClick={() => setTab("Frame Editor")}>
                Mở Frame Editor →
              </button>
            </>
          )}
        </section>
      )}
      {tab === "Frame Editor" && selected?.kind === "SPRITE" && sprite && (
        <section className="card">
          <h2>Frame Editor · {sprite.character.name}</h2>
          <div className="row">
            <button onClick={undo} disabled={!history.length}>
              ↶ Undo
            </button>
            <button onClick={redo} disabled={!future.length}>
              ↷ Redo
            </button>
            <label>
              Zoom {zoom}%{" "}
              <input
                type="range"
                min="25"
                max="800"
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
              />
            </label>
            <label>
              Công cụ{" "}
              <select
                value={maskMode}
                onChange={(e) => setMaskMode(e.target.value as typeof maskMode)}
              >
                <option value="move">Di chuyển crop</option>
                <option value="erase">Xóa nền</option>
                <option value="restore">Khôi phục</option>
              </select>
            </label>
            <button
              onClick={() => {
                const id = `frame_${Date.now()}`;
                change({
                  ...sprite,
                  frames: [
                    ...sprite.frames,
                    {
                      id,
                      crop: {
                        x: 0,
                        y: 0,
                        width: Math.min(100, selected.width),
                        height: Math.min(100, selected.height),
                      },
                      padding: 8,
                      pivot: { x: 0.5, y: 1 },
                      footAnchor: { x: 0.5, y: 1 },
                      headAnchor: { x: 0.5, y: 0.1 },
                    },
                  ],
                });
                setSelectedFrame(id);
              }}
            >
              Thêm crop
            </button>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "200px minmax(300px,1fr) 280px",
              gap: 15,
              overflowX: "auto",
            }}
          >
            <div style={{ maxHeight: 600, overflowY: "auto" }}>
              {sprite.frames.map((f, i) => (
                <div
                  key={f.id}
                  className="row"
                  draggable
                  onDragStart={(event) =>
                    event.dataTransfer.setData("text/plain", f.id)
                  }
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const from = event.dataTransfer.getData("text/plain");
                    const oldIndex = sprite.frames.findIndex(
                      (item) => item.id === from,
                    );
                    if (oldIndex < 0 || oldIndex === i) return;
                    const reordered = [...sprite.frames];
                    const [moving] = reordered.splice(oldIndex, 1);
                    reordered.splice(i, 0, moving);
                    change({ ...sprite, frames: reordered });
                  }}
                  style={{
                    padding: 5,
                    background: f.id === selectedFrame ? "#725b34" : undefined,
                  }}
                >
                  <span aria-hidden="true">☰</span>
                  <button onClick={() => setSelectedFrame(f.id)}>{f.id}</button>
                  <button onClick={() => moveFrame(i, -1)} aria-label="Lên">
                    ↑
                  </button>
                  <button onClick={() => moveFrame(i, 1)} aria-label="Xuống">
                    ↓
                  </button>
                </div>
              ))}
            </div>
            <div
              style={{
                overflow: "auto",
                maxHeight: 650,
                background:
                  "repeating-conic-gradient(#ccc 0% 25%, #eee 0% 50%) 50% / 20px 20px",
              }}
            >
              <div
                style={{
                  position: "relative",
                  width: Math.max(300, (selected.width * zoom) / 100),
                  height: Math.max(200, (selected.height * zoom) / 100),
                }}
              >
                <img
                  ref={imageRef}
                  src={originalUrl(selected.id)}
                  alt="Crop editor"
                  draggable={false}
                  onClick={(e) => paintMask(e.clientX, e.clientY)}
                  style={{ width: "100%", height: "100%" }}
                />
                {frame && (
                  <div
                    onPointerDown={(e) => {
                      if (maskMode !== "move") {
                        paintMask(e.clientX, e.clientY);
                        return;
                      }
                      const startX = e.clientX,
                        startY = e.clientY,
                        old = deep(frame);
                      const target = e.currentTarget;
                      target.setPointerCapture(e.pointerId);
                      target.onpointermove = (move) => {
                        const rect = imageRef.current?.getBoundingClientRect();
                        if (!rect) return;
                        editFrame({
                          ...old,
                          crop: {
                            ...old.crop,
                            x: Math.round(
                              Math.max(
                                0,
                                Math.min(
                                  selected.width - old.crop.width,
                                  old.crop.x +
                                    ((move.clientX - startX) * selected.width) /
                                      rect.width,
                                ),
                              ),
                            ),
                            y: Math.round(
                              Math.max(
                                0,
                                Math.min(
                                  selected.height - old.crop.height,
                                  old.crop.y +
                                    ((move.clientY - startY) *
                                      selected.height) /
                                      rect.height,
                                ),
                              ),
                            ),
                          },
                        });
                      };
                      target.onpointerup = () => {
                        target.onpointermove = null;
                      };
                    }}
                    style={{
                      position: "absolute",
                      left: `${(frame.crop.x / selected.width) * 100}%`,
                      top: `${(frame.crop.y / selected.height) * 100}%`,
                      width: `${(frame.crop.width / selected.width) * 100}%`,
                      height: `${(frame.crop.height / selected.height) * 100}%`,
                      border: "2px solid #ff0",
                      cursor: "move",
                      touchAction: "none",
                    }}
                  >
                    <span
                      aria-label="Resize crop"
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        const startX = event.clientX,
                          startY = event.clientY,
                          old = deep(frame),
                          target = event.currentTarget;
                        target.setPointerCapture(event.pointerId);
                        target.onpointermove = (move) => {
                          const rect =
                            imageRef.current?.getBoundingClientRect();
                          if (!rect) return;
                          editFrame({
                            ...old,
                            crop: {
                              ...old.crop,
                              width: Math.round(
                                Math.max(
                                  1,
                                  Math.min(
                                    selected.width - old.crop.x,
                                    old.crop.width +
                                      ((move.clientX - startX) *
                                        selected.width) /
                                        rect.width,
                                  ),
                                ),
                              ),
                              height: Math.round(
                                Math.max(
                                  1,
                                  Math.min(
                                    selected.height - old.crop.y,
                                    old.crop.height +
                                      ((move.clientY - startY) *
                                        selected.height) /
                                        rect.height,
                                  ),
                                ),
                              ),
                            },
                          });
                        };
                        target.onpointerup = () => {
                          target.onpointermove = null;
                        };
                      }}
                      style={{
                        position: "absolute",
                        right: -6,
                        bottom: -6,
                        width: 12,
                        height: 12,
                        background: "#ff0",
                        cursor: "nwse-resize",
                        touchAction: "none",
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
            <div className="stack">
              {frame && (
                <>
                  <h3>{frame.id}</h3>
                  <div className="row">
                    {[
                      ["Pivot", showPivot, setShowPivot],
                      ["Hitbox", showHitbox, setShowHitbox],
                      ["Hurtbox", showHurtbox, setShowHurtbox],
                    ].map(([label, checked, setter]) => (
                      <label key={String(label)}>
                        <input
                          type="checkbox"
                          checked={checked as boolean}
                          onChange={(e) =>
                            (setter as (v: boolean) => void)(e.target.checked)
                          }
                        />
                        {String(label)}
                      </label>
                    ))}
                  </div>
                  {version?.atlasKey && (
                    <div
                      style={{
                        position: "relative",
                        width: 240,
                        height: 240,
                        background:
                          "repeating-conic-gradient(#ccc 0% 25%, #eee 0% 50%) 50% / 20px 20px",
                      }}
                    >
                      <img
                        src={`/api/battle-assets/${selected.id}/file/frame_${frame.id}.png?version=${version.version}`}
                        alt="Frame RGBA đã xử lý"
                        style={{ width: "100%", height: "100%" }}
                      />
                      {showPivot && (
                        <span
                          onPointerDown={(event) =>
                            dragProperty(event, "pivot")
                          }
                          style={{
                            position: "absolute",
                            left: `${frame.pivot.x * 100}%`,
                            top: `${frame.pivot.y * 100}%`,
                            color: "yellow",
                            fontSize: 25,
                            transform: "translate(-50%,-50%)",
                            cursor: "move",
                            touchAction: "none",
                          }}
                        >
                          +
                        </span>
                      )}
                      {[
                        [showHitbox, frame.hitbox, "red"],
                        [showHurtbox, frame.hurtbox, "cyan"],
                      ].map(([enabled, b, color], i) =>
                        enabled && b ? (
                          <span
                            key={i}
                            onPointerDown={(event) =>
                              dragProperty(
                                event,
                                i === 0 ? "hitbox" : "hurtbox",
                              )
                            }
                            style={{
                              position: "absolute",
                              left: `${((b as Box).x / sprite.canvas.width) * 100}%`,
                              top: `${((b as Box).y / sprite.canvas.height) * 100}%`,
                              width: `${((b as Box).width / sprite.canvas.width) * 100}%`,
                              height: `${((b as Box).height / sprite.canvas.height) * 100}%`,
                              border: `2px solid ${color}`,
                              cursor: "move",
                              touchAction: "none",
                            }}
                          />
                        ) : null,
                      )}
                    </div>
                  )}
                  {(
                    [
                      "crop",
                      "pivot",
                      "footAnchor",
                      "headAnchor",
                      "hitbox",
                      "hurtbox",
                      "collisionBox",
                    ] as const
                  ).map((key) => (
                    <fieldset key={key}>
                      <legend>{key}</legend>
                      <div className="row" style={{ flexWrap: "wrap" }}>
                        {(key === "crop" ||
                        key === "hitbox" ||
                        key === "hurtbox" ||
                        key === "collisionBox"
                          ? ["x", "y", "width", "height"]
                          : ["x", "y"]
                        ).map((field) => (
                          <label key={field}>
                            {field}
                            <input
                              type="number"
                              step={
                                key === "crop" ||
                                key.includes("box") ||
                                key === "collisionBox"
                                  ? 1
                                  : 0.01
                              }
                              style={{ width: 65 }}
                              value={
                                ((frame[key] ?? {}) as Record<string, number>)[
                                  field
                                ] ?? ""
                              }
                              onChange={(e) => {
                                const value = Number(e.target.value);
                                if (
                                  key === "crop" ||
                                  key === "hitbox" ||
                                  key === "hurtbox" ||
                                  key === "collisionBox"
                                )
                                  editBox(key, field as keyof Box, value);
                                else
                                  editFrame({
                                    ...frame,
                                    [key]: { ...frame[key], [field]: value },
                                  });
                              }}
                            />
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                  <label>
                    Padding
                    <input
                      type="number"
                      value={frame.padding}
                      onChange={(e) =>
                        editFrame({ ...frame, padding: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label>
                    Color key threshold
                    <input
                      type="number"
                      value={frame.mask?.threshold ?? 0}
                      onChange={(e) =>
                        editFrame({
                          ...frame,
                          mask: {
                            ...frame.mask,
                            threshold: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  <label>
                    Feather
                    <input
                      type="number"
                      value={frame.mask?.feather ?? 0}
                      onChange={(e) =>
                        editFrame({
                          ...frame,
                          mask: {
                            ...frame.mask,
                            feather: Number(e.target.value),
                          },
                        })
                      }
                    />
                  </label>
                  <button
                    onClick={() => {
                      const copy = {
                        ...deep(frame),
                        id: `${frame.id}_${Date.now().toString(36)}`,
                      };
                      change({ ...sprite, frames: [...sprite.frames, copy] });
                      setSelectedFrame(copy.id);
                    }}
                  >
                    Nhân bản
                  </button>
                  <button onClick={() => splitFrame("x")}>Tách dọc</button>
                  <button onClick={() => splitFrame("y")}>Tách ngang</button>
                  <label>
                    Gộp với frame
                    <select
                      value={mergeTarget}
                      onChange={(event) => setMergeTarget(event.target.value)}
                    >
                      <option value="">Chọn…</option>
                      {sprite.frames
                        .filter((item) => item.id !== frame.id)
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.id}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button disabled={!mergeTarget} onClick={mergeFrames}>
                    Gộp
                  </button>
                  <button
                    onClick={() => {
                      change({
                        ...sprite,
                        frames: sprite.frames.filter((f) => f.id !== frame.id),
                      });
                      setSelectedFrame("");
                    }}
                  >
                    Xóa frame
                  </button>
                </>
              )}
            </div>
          </div>
          <button
            disabled={busy}
            onClick={() =>
              void perform(
                () =>
                  api(`/${selected.id}/draft`, {
                    method: "PUT",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify(sprite),
                  }),
                "Đã lưu sprite nháp; worker đang tạo RGBA frames và atlas",
              )
            }
          >
            Lưu và xử lý sprite
          </button>
        </section>
      )}
      {tab === "Animation Editor" && selected?.kind === "SPRITE" && sprite && (
        <section className="card">
          <h2>Animation Editor</h2>
          <div className="row">
            <label>
              Nhân vật
              <input
                value={sprite.character.name}
                onChange={(e) =>
                  change({
                    ...sprite,
                    character: { ...sprite.character, name: e.target.value },
                  })
                }
              />
            </label>
            <label>
              Code
              <input
                value={sprite.character.code}
                onChange={(e) =>
                  change({
                    ...sprite,
                    character: { ...sprite.character, code: e.target.value },
                  })
                }
              />
            </label>
            <label>
              Hệ
              <input
                value={sprite.character.element}
                onChange={(e) =>
                  change({
                    ...sprite,
                    character: { ...sprite.character, element: e.target.value },
                  })
                }
              />
            </label>
            <label>
              Màu
              <input
                value={sprite.character.color}
                onChange={(e) =>
                  change({
                    ...sprite,
                    character: { ...sprite.character, color: e.target.value },
                  })
                }
              />
            </label>
            <label>
              Spawn
              <select
                value={sprite.character.spawnSide}
                onChange={(e) =>
                  change({
                    ...sprite,
                    character: {
                      ...sprite.character,
                      spawnSide: e.target.value as "left" | "right",
                    },
                  })
                }
              >
                <option>left</option>
                <option>right</option>
              </select>
            </label>
          </div>
          <div className="row">
            <label>
              Animation
              <select
                value={animationName}
                onChange={(e) => setAnimationName(e.target.value)}
              >
                {actions.map((a) => (
                  <option key={a}>{a}</option>
                ))}
                {Object.keys(sprite.animations)
                  .filter((a) => !actions.includes(a))
                  .map((a) => (
                    <option key={a}>{a}</option>
                  ))}
              </select>
            </label>
            {!anim && (
              <button
                onClick={() =>
                  editAnimation({
                    ...blankAnimation(),
                    direction: animationName.endsWith("_left")
                      ? "left"
                      : animationName.endsWith("_right")
                        ? "right"
                        : "none",
                    loop: !["attack", "fall", "die", "hit"].includes(
                      animationName,
                    ),
                    holdLastFrame: animationName === "die",
                  })
                }
              >
                Tạo animation
              </button>
            )}
            {anim && (
              <button
                onClick={() => {
                  const name = window.prompt(
                    "Tên bản sao",
                    `${animationName}_copy`,
                  );
                  if (name && /^[a-z][a-z0-9_]{0,39}$/.test(name))
                    change({
                      ...sprite,
                      animations: { ...sprite.animations, [name]: deep(anim) },
                    });
                }}
              >
                Nhân bản
              </button>
            )}
            {anim && (
              <button
                onClick={() => {
                  const animations = { ...sprite.animations };
                  delete animations[animationName];
                  change({ ...sprite, animations });
                }}
              >
                Xóa
              </button>
            )}
          </div>
          {anim && (
            <>
              <div className="row" style={{ flexWrap: "wrap" }}>
                {(["loop", "allowFlipX", "holdLastFrame"] as const).map((k) => (
                  <label key={k}>
                    <input
                      type="checkbox"
                      checked={anim[k]}
                      onChange={(e) =>
                        editAnimation({ ...anim, [k]: e.target.checked })
                      }
                    />
                    {k}
                  </label>
                ))}
                {(["speed", "priority"] as const).map((k) => (
                  <label key={k}>
                    {k}
                    <input
                      type="number"
                      step="0.1"
                      value={anim[k]}
                      onChange={(e) =>
                        editAnimation({ ...anim, [k]: Number(e.target.value) })
                      }
                    />
                  </label>
                ))}
                <label>
                  Hướng
                  <select
                    value={anim.direction}
                    onChange={(e) =>
                      editAnimation({
                        ...anim,
                        direction: e.target.value as Animation["direction"],
                      })
                    }
                  >
                    <option>none</option>
                    <option>left</option>
                    <option>right</option>
                  </select>
                </label>
                {(["x", "y"] as const).map((axis) => (
                  <label key={axis}>
                    Root motion {axis}
                    <input
                      type="number"
                      step="1"
                      value={anim.rootMotion[axis]}
                      onChange={(event) =>
                        editAnimation({
                          ...anim,
                          rootMotion: {
                            ...anim.rootMotion,
                            [axis]: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                ))}
                <label>
                  Chuyển tiếp (ngăn bằng dấu phẩy)
                  <input
                    value={anim.transitions.join(",")}
                    onChange={(event) =>
                      editAnimation({
                        ...anim,
                        transitions: event.target.value
                          .split(",")
                          .map((value) => value.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </label>
              </div>
              <h3>Timeline</h3>
              {anim.frames.map((item, i) => (
                <div className="row" key={i} style={{ marginBottom: 6 }}>
                  <span>{i + 1}</span>
                  <select
                    value={item.frameId}
                    onChange={(e) => {
                      const frames = deep(anim.frames);
                      frames[i].frameId = e.target.value;
                      editAnimation({ ...anim, frames });
                    }}
                  >
                    {sprite.frames.map((f) => (
                      <option key={f.id}>{f.id}</option>
                    ))}
                  </select>
                  <label>
                    ms
                    <input
                      type="number"
                      min="20"
                      max="2000"
                      value={item.durationMs}
                      onChange={(e) => {
                        const frames = deep(anim.frames);
                        frames[i].durationMs = Number(e.target.value);
                        editAnimation({ ...anim, frames });
                      }}
                    />
                  </label>
                  <label>
                    Sự kiện
                    <input
                      value={item.events.join(",")}
                      onChange={(e) => {
                        const frames = deep(anim.frames);
                        frames[i].events = e.target.value
                          .split(",")
                          .map((x) => x.trim())
                          .filter(Boolean);
                        editAnimation({ ...anim, frames });
                      }}
                    />
                  </label>
                  <button
                    onClick={() => {
                      const frames = deep(anim.frames);
                      if (i > 0)
                        [frames[i - 1], frames[i]] = [frames[i], frames[i - 1]];
                      editAnimation({ ...anim, frames });
                    }}
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => {
                      const frames = deep(anim.frames);
                      if (i < frames.length - 1)
                        [frames[i + 1], frames[i]] = [frames[i], frames[i + 1]];
                      editAnimation({ ...anim, frames });
                    }}
                  >
                    ↓
                  </button>
                  <button
                    onClick={() =>
                      editAnimation({
                        ...anim,
                        frames: anim.frames.filter((_, n) => n !== i),
                      })
                    }
                  >
                    Xóa
                  </button>
                </div>
              ))}
              <button
                disabled={!sprite.frames.length}
                onClick={() =>
                  editAnimation({
                    ...anim,
                    frames: [
                      ...anim.frames,
                      {
                        frameId: sprite.frames[0].id,
                        durationMs: 160,
                        events: [],
                      },
                    ],
                  })
                }
              >
                Thêm frame
              </button>
            </>
          )}
          <p>
            <button
              disabled={busy}
              onClick={() =>
                void perform(
                  () =>
                    api(`/${selected.id}/draft`, {
                      method: "PUT",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify(sprite),
                    }),
                  "Đã lưu animation",
                )
              }
            >
              Lưu nháp
            </button>
          </p>
        </section>
      )}
      {tab === "Sprite Simulator" && (
        <section className="card">
          <h2>Sprite Simulator</h2>
          <p>
            Kiểm tra frame, chuyển hướng, combat hai nhân vật và khung OBS 9:16
            trước khi duyệt.
          </p>
          {selected?.kind === "SPRITE" && (
            <a
              href={`/admin/battle-assets/characters/${selected.id}/simulator`}
            >
              Mở simulator cho {selected.name} →
            </a>
          )}
        </section>
      )}
      {tab === "Published Assets" && (
        <section className="card">
          <h2>Publish & rollback</h2>
          {assets.map((a) => (
            <div
              key={a.id}
              style={{ borderBottom: "1px solid #665", padding: 12 }}
            >
              <b>{a.name}</b> · {a.kind} · {a.status}
              <div className="row">
                <button
                  disabled={
                    busy ||
                    !["DRAFT", "NEEDS_REVIEW", "READY_FOR_TEST"].includes(
                      a.versions[0]?.status,
                    )
                  }
                  onClick={() =>
                    void perform(
                      () => api(`/${a.id}/validate`, { method: "POST" }),
                      "Đã chạy kiểm tra",
                    )
                  }
                >
                  Validate
                </button>
                <button
                  disabled={busy || a.versions[0]?.status !== "READY_FOR_TEST"}
                  onClick={() =>
                    void perform(
                      () => api(`/${a.id}/approve`, { method: "POST" }),
                      "Đã phê duyệt",
                    )
                  }
                >
                  Approve
                </button>
                <button
                  disabled={busy || a.versions[0]?.status !== "APPROVED"}
                  onClick={() =>
                    void perform(
                      () => api(`/${a.id}/publish`, { method: "POST" }),
                      "Đã publish",
                    )
                  }
                >
                  Publish
                </button>
                {a.kind === "BACKGROUND" && a.background && (
                  <button
                    disabled={busy || a.background.isActive}
                    onClick={() =>
                      void perform(
                        () => api(`/${a.id}/activate`, { method: "POST" }),
                        "Đã chọn background",
                      )
                    }
                  >
                    {a.background.isActive ? "Đang sử dụng" : "Chọn background"}
                  </button>
                )}
                {!a.versions.some((v) => v.publishedAt) && (
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm(`Xóa bản nháp ${a.name}?`)) return;
                      void perform(async () => {
                        await api(`/${a.id}`, { method: "DELETE" });
                        setSelectedId("");
                      }, "Đã xóa bản nháp");
                    }}
                  >
                    Xóa bản nháp
                  </button>
                )}
              </div>
              {a.versions.map((v) => (
                <div key={v.id}>
                  v{v.version} · {v.status}{" "}
                  {v.publishedAt && (
                    <button
                      disabled={busy || v.status === "PUBLISHED"}
                      onClick={() =>
                        void perform(
                          () =>
                            api(`/${a.id}/rollback/${v.version}`, {
                              method: "POST",
                            }),
                          "Đã rollback",
                        )
                      }
                    >
                      Rollback v{v.version}
                    </button>
                  )}
                  {v.validations?.at(-1)?.warnings?.map((w, i) => (
                    <p key={i} className="muted">
                      ⚠ {w}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
