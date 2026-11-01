"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BattlePreview,
  type BattleMetadata,
} from "../../components/BattlePreview";

type Asset = {
  id: string;
  name: string;
  kind: "SPRITE" | "BACKGROUND";
  versions: {
    version: number;
    status: string;
    metadata: Record<string, unknown>;
  }[];
  character?: { code: string } | null;
  background?: { isActive: boolean } | null;
};
type Live = { id: string; uniqueId: string; title: string; status: string };
type BattleConfig = { leftAssetId: string; rightAssetId: string; backgroundAssetId: string | null; leftVersion: number; rightVersion: number; backgroundVersion: number | null };
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${url}`, { cache: "no-store", ...init });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body as T;
}
export default function BattleArenaAssets() {
  const [assets, setAssets] = useState<Asset[]>([]),
    [lives, setLives] = useState<Live[]>([]),
    [liveId, setLiveId] = useState(""),
    [savedConfig, setSavedConfig] = useState<BattleConfig | null>(null),
    [battleUrl, setBattleUrl] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [primary, setPrimary] = useState(""),
    [secondary, setSecondary] = useState(""),
    [background, setBackground] = useState(""),
    [meta, setMeta] = useState<Record<string, BattleMetadata>>({}),
    [error, setError] = useState("");
  useEffect(() => {
    void (async () => {
      try {
        const [list, channels] = await Promise.all([
          api<Asset[]>("/battle-assets?published=true"),
          api<Live[]>("/lives"),
        ]);
        setAssets(list);
        setLives(channels);
        setLiveId(channels[0]?.id ?? "");
        const sprites = list.filter((a) => a.kind === "SPRITE");
        setPrimary(sprites[0]?.id ?? "");
        setSecondary(sprites[1]?.id ?? "");
        setBackground(list.find((a) => a.background?.isActive)?.id ?? "");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);
  useEffect(() => {
    if (!liveId) return;
    let current = true;
    setBattleUrl("");
    setSavedConfig(null);
    void api<BattleConfig | { configured: false }>(`/lives/${liveId}/battle-config`)
      .then((config) => {
        if (!current) return;
        if ("leftAssetId" in config) {
          setSavedConfig(config);
          setPrimary(config.leftAssetId);
          setSecondary(config.rightAssetId);
          setBackground(config.backgroundAssetId ?? "");
        } else setSavedConfig(null);
      })
      .catch((e) => { if (current) setError(String(e)); });
    return () => { current = false; };
  }, [liveId]);
  const versionFor = (assetId: string) => {
    if (savedConfig?.leftAssetId === assetId) return savedConfig.leftVersion;
    if (savedConfig?.rightAssetId === assetId) return savedConfig.rightVersion;
    if (savedConfig?.backgroundAssetId === assetId) return savedConfig.backgroundVersion;
    return assets.find((asset) => asset.id === assetId)?.versions[0]?.version;
  };
  async function saveBattle() {
    if (!liveId || !primary || !secondary) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const config = await api<BattleConfig>(`/lives/${liveId}/battle-config`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ leftAssetId: primary, rightAssetId: secondary, backgroundAssetId: background || null }),
      });
      setSavedConfig(config);
      setBattleUrl("");
      setNotice("Đã gắn hai nhân vật vào LIVE. Tạo liên kết Battle để mở trong OBS.");
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function createBattleUrl() {
    setBusy(true); setError("");
    try {
      const result = await api<{ url: string }>(`/lives/${liveId}/battle-overlay-token`, { method: "POST" });
      setBattleUrl(result.url);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  useEffect(() => {
    for (const id of [primary, secondary]) {
      const version = versionFor(id);
      const key = `${id}:${version}`;
      if (!id || !version || meta[key]) continue;
      void fetch(
        `/api/battle-assets/${id}/file/metadata.json?version=${version}`,
      )
        .then((r) => {
          if (!r.ok) throw new Error("Metadata unavailable");
          return r.json();
        })
        .then((value) =>
          setMeta((current) => ({ ...current, [key]: value as BattleMetadata })),
        )
        .catch((e) => setError(String(e)));
    }
  }, [assets, primary, secondary, meta, savedConfig]);
  const sprites = assets.filter((a) => a.kind === "SPRITE");
  const backgrounds = assets.filter((a) => a.kind === "BACKGROUND");
  const characters = useMemo(
    () =>
      [primary, secondary].flatMap((id, index) => {
        const asset = assets.find((a) => a.id === id),
          version = versionFor(id),
          metadata = meta[`${id}:${version}`];
        if (!asset || !metadata || !version) return [];
        const idle =
          metadata.animations.idle?.frames[0]?.frameId ??
          Object.keys(metadata.frames)[0];
        return [
          {
            atlasUrl: `/api/battle-assets/${id}/file/atlas.png?version=${version}`,
            metadata,
            frameId: idle,
            x: index ? 380 : 160,
            y: 730,
            scale: 0.5,
            flipX: !!index,
            label: asset.name,
          },
        ];
      }),
    [assets, primary, secondary, meta, savedConfig],
  );
  return (
    <main className="shell">
      <a href="/">← Dashboard</a>
      <h1>Battle Arena · Asset đã publish</h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="muted">
        Chỉ hiển thị phiên bản đã Publish. Nếu danh sách trống, admin cần kiểm tra frame trong Sprite Studio, lưu nháp, Validate đạt, Approve rồi Publish.
      </p>
      {sprites.length < 2 && <p role="status">Hiện có {sprites.length} nhân vật đã Publish; cần ít nhất hai nhân vật để gắn LIVE. <a href="/admin/battle-assets">Mở Sprite Studio →</a></p>}
      <label>LIVE TikTok
        <select value={liveId} onChange={(e) => setLiveId(e.target.value)}>
          <option value="">Chọn LIVE…</option>
          {lives.map((live) => <option key={live.id} value={live.id}>@{live.uniqueId} · {live.title} · {live.status}</option>)}
        </select>
      </label>
      {!lives.length && <p className="muted">Tạo TikTok ID trên Dashboard trước khi gắn Battle. <a href="/">Mở Dashboard →</a></p>}
      <div className="row" style={{ flexWrap: "wrap" }}>
        <label>
          Nhân vật trái
          <select value={primary} onChange={(e) => setPrimary(e.target.value)}>
            <option value="">Chọn…</option>
            {sprites.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · v{a.versions[0].version}
              </option>
            ))}
          </select>
        </label>
        <label>
          Nhân vật phải
          <select
            value={secondary}
            onChange={(e) => setSecondary(e.target.value)}
          >
            <option value="">Chọn…</option>
            {sprites.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · v{a.versions[0].version}
              </option>
            ))}
          </select>
        </label>
        <label>
          Background
          <select
            value={background}
            onChange={(e) => setBackground(e.target.value)}
          >
            <option value="">Màu tối</option>
            {backgrounds.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button disabled={busy || !liveId || !primary || !secondary || primary === secondary} onClick={() => void saveBattle()}>Gắn nhân vật vào LIVE</button>
        <button disabled={busy || !liveId || !savedConfig} onClick={() => void createBattleUrl()}>Tạo liên kết Battle cho OBS</button>
        {liveId && <a href={`/live/${liveId}`}>Mở Dashboard LIVE →</a>}
      </div>
      {notice && <p role="status">{notice}</p>}
      {battleUrl && <label>URL Battle OBS (giữ bí mật token)<input readOnly value={battleUrl} onFocus={(e) => e.currentTarget.select()} /></label>}
      {battleUrl && <p className="muted">Mở Dashboard LIVE, bấm Kết nối TikTok, rồi thêm URL này vào OBS Browser Source 1080 × 1920. Trong Docker test, dùng tab Simulator của Dashboard để thử sự kiện.</p>}
      {savedConfig && <p className="muted">LIVE đã gắn phiên bản nhân vật v{savedConfig.leftVersion} và v{savedConfig.rightVersion}. OBS dùng phiên bản này cho đến khi bạn lưu cấu hình mới.</p>}
      <section className="card" style={{ maxWidth: 600 }}>
        <BattlePreview
          characters={characters}
          backgroundUrl={
            background
              ? `/api/battle-assets/${background}/file/background?version=${versionFor(background)}`
              : undefined
          }
          showGround
          groundY={730}
        />
      </section>
      <p className="muted">
        Battle OBS nhận sự kiện TikTok mới từ LIVE đã chọn để xem hoạt ảnh. Hiện chưa có Battle Engine xác nhận HP, hit và damage nên đây là chế độ xem trực tiếp hoạt ảnh, chưa phải trận đấu tính điểm.
      </p>
    </main>
  );
}
