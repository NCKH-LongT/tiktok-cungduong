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
export default function BattleArenaAssets() {
  const [assets, setAssets] = useState<Asset[]>([]),
    [primary, setPrimary] = useState(""),
    [secondary, setSecondary] = useState(""),
    [background, setBackground] = useState(""),
    [meta, setMeta] = useState<Record<string, BattleMetadata>>({}),
    [error, setError] = useState("");
  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/battle-assets?published=true", {
          cache: "no-store",
        });
        if (!r.ok)
          throw new Error(
            r.status === 401
              ? "Cần đăng nhập để xem Battle Arena."
              : "Không tải được asset đã publish.",
          );
        const list = (await r.json()) as Asset[];
        setAssets(list);
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
    for (const id of [primary, secondary]) {
      if (!id || meta[id]) continue;
      const asset = assets.find((a) => a.id === id);
      const version = asset?.versions[0]?.version;
      if (!version) continue;
      void fetch(
        `/api/battle-assets/${id}/file/metadata.json?version=${version}`,
      )
        .then((r) => {
          if (!r.ok) throw new Error("Metadata unavailable");
          return r.json();
        })
        .then((value) =>
          setMeta((current) => ({ ...current, [id]: value as BattleMetadata })),
        )
        .catch((e) => setError(String(e)));
    }
  }, [assets, primary, secondary, meta]);
  const sprites = assets.filter((a) => a.kind === "SPRITE");
  const backgrounds = assets.filter((a) => a.kind === "BACKGROUND");
  const characters = useMemo(
    () =>
      [primary, secondary].flatMap((id, index) => {
        const asset = assets.find((a) => a.id === id),
          metadata = meta[id],
          version = asset?.versions[0]?.version;
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
    [assets, primary, secondary, meta],
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
        Chỉ hiển thị phiên bản đã duyệt. Phiên bản được giữ cố định khi trang
        đang mở; tải lại để nhận bản mới.
      </p>
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
      <section className="card" style={{ maxWidth: 600 }}>
        <BattlePreview
          characters={characters}
          backgroundUrl={
            background
              ? `/api/battle-assets/${background}/file/background`
              : undefined
          }
          showGround
          groundY={730}
        />
      </section>
      <p className="muted">
        Đây là màn hình kiểm tra asset đã publish; trận đấu thật cần Battle
        Engine backend để xác nhận hit, HP và damage.
      </p>
    </main>
  );
}
