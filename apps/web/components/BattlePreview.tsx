"use client";

import { useEffect, useRef } from "react";
import {
  Application,
  Assets,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
} from "pixi.js";

export type BattleMetadata = {
  canvas: { width: number; height: number };
  frames: Record<
    string,
    {
      x: number;
      y: number;
      width: number;
      height: number;
      pivot?: { x: number; y: number };
      headAnchor?: { x: number; y: number };
      hitbox?: { x: number; y: number; width: number; height: number };
      hurtbox?: { x: number; y: number; width: number; height: number };
    }
  >;
  animations: Record<
    string,
    {
      loop: boolean;
      holdLastFrame?: boolean;
      frames: { frameId: string; durationMs: number; events?: string[] }[];
    }
  >;
};
type Character = {
  atlasUrl: string;
  metadata: BattleMetadata;
  frameId: string;
  x: number;
  y: number;
  scale: number;
  flipX?: boolean;
  avatarUrl?: string;
  label?: string;
};
export function BattlePreview({
  characters,
  backgroundUrl,
  showPivot,
  showHitbox,
  showHurtbox,
  showGround,
  groundY = 730,
  zoom = 1,
}: {
  characters: Character[];
  backgroundUrl?: string;
  showPivot?: boolean;
  showHitbox?: boolean;
  showHurtbox?: boolean;
  showGround?: boolean;
  groundY?: number;
  zoom?: number;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const textureRef = useRef<Map<string, Texture>>(new Map());
  const frameTextureRef = useRef<Map<string, Texture>>(new Map());
  const stageRef = useRef<Container | null>(null);
  useEffect(() => {
    let disposed = false;
    const app = new Application();
    void (async () => {
      await app.init({
        width: 540,
        height: 960,
        backgroundColor: 0x101522,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(2, window.devicePixelRatio || 1),
      });
      if (disposed) {
        app.destroy(true);
        return;
      }
      appRef.current = app;
      app.canvas.style.width = "100%";
      app.canvas.style.height = "100%";
      holder.current?.appendChild(app.canvas);
      const stage = new Container();
      app.stage.addChild(stage);
      stageRef.current = stage;
      for (const url of [
        ...new Set(
          characters
            .flatMap((x) => [x.atlasUrl, ...(x.avatarUrl ? [x.avatarUrl] : [])])
            .concat(backgroundUrl ? [backgroundUrl] : []),
        ),
      ]) {
        try {
          textureRef.current.set(url, await Assets.load<Texture>(url));
        } catch (e) {
          console.error("Battle texture load failed", url, e);
        }
      }
      draw();
    })();
    return () => {
      disposed = true;
      stageRef.current = null;
      appRef.current = null;
      for (const texture of frameTextureRef.current.values()) texture.destroy();
      frameTextureRef.current.clear();
      textureRef.current.clear();
      try {
        app.destroy(true);
      } catch {}
    };
  }, []);
  const draw = () => {
    const stage = stageRef.current;
    if (!stage) return;
    stage
      .removeChildren()
      .forEach((child) => child.destroy({ children: true }));
    const bg = backgroundUrl && textureRef.current.get(backgroundUrl);
    if (bg) {
      const sprite = new Sprite(bg);
      sprite.width = 540;
      sprite.height = 960;
      stage.addChild(sprite);
    }
    if (showGround) {
      const line = new Graphics()
        .moveTo(0, groundY)
        .lineTo(540, groundY)
        .stroke({ color: 0xffdd55, width: 2, alpha: 0.8 });
      stage.addChild(line);
    }
    characters.forEach((c) => {
      const base = textureRef.current.get(c.atlasUrl),
        f = c.metadata.frames[c.frameId];
      if (!base || !f) return;
      const key = `${c.atlasUrl}:${c.frameId}`;
      let cropped = frameTextureRef.current.get(key);
      if (!cropped) {
        cropped = new Texture({
          source: base.source,
          frame: new Rectangle(f.x, f.y, f.width, f.height),
        });
        frameTextureRef.current.set(key, cropped);
      }
      const body = new Sprite(cropped);
      const pivot = f.pivot ?? { x: 0.5, y: 1 };
      body.anchor.set(pivot.x, pivot.y);
      body.position.set(c.x, c.y);
      body.scale.set(c.scale * zoom * (c.flipX ? -1 : 1), c.scale * zoom);
      stage.addChild(body);
      const head = f.headAnchor ?? { x: 0.5, y: 0.1 };
      const headX =
        c.x +
        (head.x - pivot.x) * f.width * c.scale * zoom * (c.flipX ? -1 : 1);
      const headY = c.y + (head.y - pivot.y) * f.height * c.scale * zoom;
      const avatarTexture = c.avatarUrl && textureRef.current.get(c.avatarUrl);
      if (avatarTexture) {
        const avatar = new Sprite(avatarTexture);
        avatar.anchor.set(0.5);
        avatar.position.set(headX, headY - 12);
        avatar.width = 32;
        avatar.height = 32;
        const mask = new Graphics().circle(headX, headY - 12, 16).fill(0xffffff);
        stage.addChild(mask, avatar);
        avatar.mask = mask;
      }
      if (c.label) {
        const name = new Text({
          text: c.label.slice(0, 30),
          style: { fontSize: 13, fill: 0xffffff, stroke: { color: 0x111111, width: 3 } },
        });
        name.anchor.set(0.5, 1);
        name.position.set(headX, headY - 33);
        stage.addChild(name);
      }
      if (showPivot)
        stage.addChild(new Graphics().circle(c.x, c.y, 4).fill(0xffe45c));
      for (const [enabled, box, color] of [
        [showHitbox, f.hitbox, 0xff3636],
        [showHurtbox, f.hurtbox, 0x36d8ff],
      ] as const) {
        if (!enabled || !box) continue;
        const scale = c.scale * zoom;
        const x =
          c.x + (box.x - pivot.x * f.width) * scale * (c.flipX ? -1 : 1);
        const y = c.y + (box.y - pivot.y * f.height) * scale;
        stage.addChild(
          new Graphics()
            .rect(x, y, box.width * scale, box.height * scale)
            .stroke({ color, width: 2 }),
        );
      }
    });
  };
  useEffect(() => {
    void (async () => {
      for (const url of [
        ...new Set(
          characters
            .flatMap((x) => [x.atlasUrl, ...(x.avatarUrl ? [x.avatarUrl] : [])])
            .concat(backgroundUrl ? [backgroundUrl] : []),
        ),
      ])
        if (!textureRef.current.has(url)) {
          try {
            textureRef.current.set(url, await Assets.load<Texture>(url));
          } catch (e) {
            console.error(e);
          }
        }
      draw();
    })();
  }, [
    characters,
    backgroundUrl,
    showPivot,
    showHitbox,
    showHurtbox,
    showGround,
    groundY,
    zoom,
  ]);
  return (
    <div
      ref={holder}
      aria-label="Battle Arena preview 9:16"
      style={{
        width: "min(100%,540px)",
        aspectRatio: "9/16",
        overflow: "hidden",
        margin: "auto",
      }}
    />
  );
}
