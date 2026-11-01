import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  Req,
  Res,
  HttpException,
  Injectable,
  OnModuleDestroy,
} from "@nestjs/common";
import {
  PrismaClient,
  type BattleAssetKind,
  type BattleAssetStatus,
} from "@prisma/client";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import type { Request, Response } from "express";
import { z } from "zod";

const root = path.resolve(
  process.env.BATTLE_ASSET_ROOT ?? "/var/lib/cungduong/battle-assets",
);
const uuid = z.uuid();
const box = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive(),
  height: z.number().positive(),
});
const anchor = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});
const frame = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,50}$/),
  crop: box,
  padding: z.number().int().min(0).max(80).default(8),
  pivot: anchor.default({ x: 0.5, y: 1 }),
  footAnchor: anchor.default({ x: 0.5, y: 1 }),
  headAnchor: anchor.default({ x: 0.5, y: 0.1 }),
  reviewRequired: z.boolean().optional(),
  reviewed: z.boolean().optional(),
  hitbox: box.optional(),
  hurtbox: box.optional(),
  collisionBox: box.optional(),
  mask: z
    .object({
      color: z
        .tuple([
          z.number().int().min(0).max(255),
          z.number().int().min(0).max(255),
          z.number().int().min(0).max(255),
        ])
        .optional(),
      threshold: z.number().min(0).max(255).optional(),
      auto: z.boolean().optional(),
      strip: z.tuple([z.number().int(), z.number().int(), z.number().int().positive(), z.number().int().positive()]).optional(),
      feather: z.number().int().min(0).max(10).optional(),
      strokes: z
        .array(
          z.object({
            x: z.number(),
            y: z.number(),
            radius: z.number().min(1).max(100),
            mode: z.enum(["erase", "restore"]),
          }),
        )
        .max(500)
        .optional(),
    })
    .optional(),
});
const animation = z.object({
  loop: z.boolean().default(false),
  speed: z.number().min(0.1).max(4).default(1),
  direction: z.enum(["left", "right", "none"]).default("none"),
  allowFlipX: z.boolean().default(false),
  holdLastFrame: z.boolean().default(false),
  priority: z.number().int().min(0).max(100).default(0),
  rootMotion: z
    .object({ x: z.number(), y: z.number() })
    .default({ x: 0, y: 0 }),
  transitions: z.array(z.string()).max(20).default([]),
  frames: z
    .array(
      z.object({
        frameId: z.string(),
        durationMs: z.number().int().min(20).max(2000),
        events: z.array(z.string()).max(10).default([]),
      }),
    )
    .max(150),
});
const spriteDraft = z.object({
  sourceScale: z.number().min(0.1).max(8).optional(),
  canvas: z
    .object({
      width: z.number().int().min(64).max(1024),
      height: z.number().int().min(64).max(1024),
    })
    .default({ width: 512, height: 512 }),
  frames: z.array(frame).min(1).max(150),
  animations: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), animation),
  character: z.object({
    code: z.string().regex(/^[a-z0-9_-]{2,40}$/),
    name: z.string().trim().min(1).max(100),
    element: z.string().max(30),
    color: z.string().max(30),
    spawnSide: z.enum(["left", "right"]),
  }),
});
const backgroundDraft = z.object({
  fit: z.enum(["contain", "cover", "custom"]).default("cover"),
  brightness: z.number().min(0).max(2).default(1),
  contrast: z.number().min(0).max(2).default(1),
  opacity: z.number().min(0).max(1).default(1),
  scale: z.number().min(0.1).max(5).default(1),
  x: z.number().min(-2000).max(2000).default(0),
  y: z.number().min(-2000).max(2000).default(0),
  groundZones: z
    .array(
      z.object({
        left: z.number().min(0).max(1080),
        right: z.number().min(0).max(1080),
        y: z.number().min(0).max(1920),
      }),
    )
    .max(20)
    .default([]),
  bounds: z
    .object({
      left: z.number().min(0).max(1080),
      right: z.number().min(0).max(1080),
    })
    .default({ left: 0, right: 1080 }),
  uiSafeZones: z.array(box).max(20).default([]),
});
const err = (status: number, message: string): never => {
  throw new HttpException({ error: message }, status);
};
const parseId = (id: string) => uuid.parse(id);
const media = (bytes: Buffer): { mime: string; ext: string } | null =>
  bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? { mime: "image/png", ext: "png" }
    : bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
      ? { mime: "image/jpeg", ext: "jpg" }
      : bytes.toString("ascii", 0, 4) === "RIFF" &&
          bytes.toString("ascii", 8, 12) === "WEBP"
        ? { mime: "image/webp", ext: "webp" }
        : null;
const safeFile = (...parts: string[]) => {
  const result = path.resolve(root, ...parts);
  if (!result.startsWith(root + path.sep)) err(400, "Invalid file path");
  return result;
};

@Injectable()
export class BattleAssetsService implements OnModuleDestroy {
  db = new PrismaClient();
  redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });
  queue = new Queue("battle-assets", { connection: this.redis });
  async onModuleDestroy() {
    await this.queue.close();
    await this.redis.quit();
    await this.db.$disconnect();
  }
  async user(req: Request) {
    const sid = req.cookies?.sid;
    if (typeof sid !== "string") err(401, "Authentication required");
    const session = await this.db.authSession.findUnique({
      where: { tokenHash: createHash("sha256").update(sid).digest("hex") },
      include: { user: true },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt < new Date() ||
      !session.user.active ||
      session.user.deletedAt
    )
      err(401, "Session expired");
    return session!.user;
  }
  async canManage(req: Request) {
    const user = await this.user(req);
    if (user.role === "SUPER_ADMIN") return user;
    if (user.role !== "ADMIN") err(403, "Administrator role required");
    const grant = await this.db.permission.findFirst({
      where: {
        code: "battle.assets.manage",
        roles: {
          some: {
            role: {
              OR: [
                { code: user.role },
                { users: { some: { userId: user.id } } },
              ],
            },
          },
        },
      },
    });
    if (!grant) err(403, "battle.assets.manage required");
    return user;
  }
}

@Controller("battle-assets")
export class BattleAssetsController {
  constructor(private readonly s: BattleAssetsService) {}
  @Delete(":id")
  async remove(@Req() req: Request, @Param("id") id: string) {
    const user = await this.s.canManage(req);
    parseId(id);
    const asset = await this.s.db.battleAsset.findUnique({
      where: { id },
      include: { versions: { select: { publishedAt: true } } },
    });
    if (!asset) return err(404, "Asset not found");
    if (asset.versions.some((v) => v.publishedAt))
      return err(409, "Published assets are immutable; use rollback");
    const jobs = await this.s.queue.getJobs(["active", "waiting", "delayed"], 0, 1000);
    if (jobs.some((job) => job.data?.assetId === id))
      return err(409, "Asset is still processing; retry shortly");
    await this.s.db.$transaction(async (tx) => {
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "battle.asset.delete",
          targetId: id,
          metadata: { name: asset.name, checksum: asset.checksum },
        },
      });
      await tx.battleAsset.delete({ where: { id } });
    });
    await rm(safeFile(id), { recursive: true, force: true });
    return { deleted: true };
  }
  @Get() async list(
    @Req() req: Request,
    @Query("published") published?: string,
  ) {
    if (published === "true") {
      await this.s.user(req);
      return this.s.db.battleAsset.findMany({
        where: { versions: { some: { status: "PUBLISHED" } } },
        include: {
          versions: {
            where: { status: "PUBLISHED" },
            orderBy: { version: "desc" },
            take: 1,
          },
          character: true,
          background: true,
        },
        orderBy: { createdAt: "desc" },
      });
    }
    await this.s.canManage(req);
    return this.s.db.battleAsset.findMany({
      include: {
        versions: { orderBy: { version: "desc" } },
        character: true,
        background: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }
  @Get(":id") async get(@Req() req: Request, @Param("id") id: string) {
    await this.s.canManage(req);
    parseId(id);
    const item = await this.s.db.battleAsset.findUnique({
      where: { id },
      include: {
        versions: {
          orderBy: { version: "desc" },
          include: { validations: true },
        },
        character: true,
        background: true,
      },
    });
    if (!item) err(404, "Asset not found");
    return item;
  }
  @Post("upload") async upload(
    @Req() req: Request,
    @Query("kind") kindInput: string,
    @Query("name") nameInput: string,
  ) {
    const user = await this.s.canManage(req);
    const kind = z.enum(["SPRITE", "BACKGROUND"]).safeParse(kindInput);
    if (!kind.success) err(400, "Invalid asset kind");
    const name = z.string().trim().min(1).max(100).safeParse(nameInput);
    if (!name.success) err(400, "Invalid asset name");
    const bytes = req.body;
    if (
      !Buffer.isBuffer(bytes) ||
      !bytes.length ||
      bytes.length > 12 * 1024 * 1024
    )
      err(413, "Image must be at most 12 MB");
    const type = media(bytes);
    if (!type) return err(415, "Only PNG, JPEG and WebP images are accepted");
    if (kind.data === "SPRITE" && type.mime !== "image/png")
      err(415, "Sprite sheet must be PNG");
    const id = randomUUID();
    const key = `${id}/original.${type.ext}`;
    await mkdir(safeFile(id), { recursive: true });
    await writeFile(safeFile(key), bytes, { flag: "wx" });
    const asset = await this.s.db.battleAsset.create({
      data: {
        id,
        kind: kind.data as BattleAssetKind,
        name: name.data!,
        originalKey: key,
        mimeType: type.mime,
        checksum: createHash("sha256").update(bytes).digest("hex"),
        width: 0,
        height: 0,
        status: "UPLOADED",
        ownerId: user.id,
        versions: { create: { version: 1, status: "DRAFT" } },
      },
      include: { versions: true },
    });
    await this.s.queue.add(
      "inspect",
      { assetId: id },
      {
        attempts: 2,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
    return asset;
  }
  @Post(":id/auto-draft") async autoDraft(@Req() req: Request, @Param("id") id: string) {
    await this.s.canManage(req);
    parseId(id);
    const asset = await this.s.db.battleAsset.findUnique({
      where: { id }, include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    if (!asset || asset.kind !== "SPRITE") err(404, "Sprite asset not found");
    const profiles = JSON.parse(await readFile(new URL("../../sprite-worker/profiles.json", import.meta.url), "utf8")) as Record<string, unknown>;
    if (!profiles[asset!.checksum]) err(422, "No measured profile for this sprite sheet");
    const latest = asset!.versions[0];
    const metadata = latest.metadata as Record<string, unknown>;
    const needsNewVersion = Array.isArray(metadata.frames) ||
      ["PUBLISHED", "ARCHIVED", "APPROVED"].includes(latest.status);
    const target = needsNewVersion
      ? await this.s.db.battleAssetVersion.create({
          data: { assetId: id, version: latest.version + 1, status: "DRAFT" },
        })
      : latest;
    await this.s.queue.add("inspect", { assetId: id },
      { attempts: 2, backoff: { type: "exponential", delay: 1000 }, removeOnComplete: 100, removeOnFail: 100 });
    return { queued: true, version: target.version };
  }
  @Put(":id/draft") async saveDraft(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    await this.s.canManage(req);
    parseId(id);
    const asset = await this.s.db.battleAsset.findUnique({
      where: { id },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    if (!asset) err(404, "Asset not found");
    const schema = asset!.kind === "SPRITE" ? spriteDraft : backgroundDraft;
    const result = schema.safeParse(body);
    if (!result.success)
      err(400, result.error.issues.map((x) => x.message).join("; "));
    let version = asset!.versions[0];
    if (version?.status === "PUBLISHED" || version?.status === "ARCHIVED")
      version = await this.s.db.battleAssetVersion.create({
        data: { assetId: id, version: version.version + 1, status: "DRAFT" },
      });
    await this.s.db.$transaction(async (tx) => {
      await tx.battleAssetVersion.update({
        where: { id: version.id },
        data: {
          metadata: result.data as object,
          status: "DRAFT",
          atlasKey: null,
          checksum: null,
        },
      });
      if (asset!.kind === "SPRITE") {
        await tx.battleAnimation.deleteMany({
          where: { versionId: version.id },
        });
        for (const [name, animation] of Object.entries(
          (result.data as z.infer<typeof spriteDraft>).animations,
        ))
          await tx.battleAnimation.create({
            data: {
              versionId: version.id,
              name,
              config: {
                loop: animation.loop,
                speed: animation.speed,
                direction: animation.direction,
                allowFlipX: animation.allowFlipX,
                holdLastFrame: animation.holdLastFrame,
                priority: animation.priority,
                rootMotion: animation.rootMotion,
                transitions: animation.transitions,
              },
              frames: {
                create: animation.frames.map((f, ordinal) => ({
                  frameId: f.frameId,
                  ordinal,
                  durationMs: f.durationMs,
                  events: f.events,
                })),
              },
            },
          });
      }
    });
    await this.s.db.battleAsset.update({
      where: { id },
      data: { status: "DRAFT" },
    });
    if (asset!.kind === "SPRITE")
      await this.s.queue.add(
        "render",
        { assetId: id, versionId: version.id },
        { attempts: 1, removeOnComplete: 100, removeOnFail: 100 },
      );
    return { versionId: version.id, version: version.version, status: "DRAFT" };
  }
  @Post(":id/validate") async validate(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    await this.s.canManage(req);
    parseId(id);
    const asset = await this.s.db.battleAsset.findUnique({
      where: { id },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    if (!asset) err(404, "Asset not found");
    const version = asset!.versions[0];
    if (
      !version ||
      !["DRAFT", "NEEDS_REVIEW", "READY_FOR_TEST"].includes(version.status)
    )
      err(409, "No editable draft");
    const data = version.metadata as Record<string, any>;
    const warnings: string[] = [];
    if (asset!.kind === "SPRITE") {
      if (!version.atlasKey || !version.checksum)
        warnings.push("Atlas not rendered");
      for (const action of [
        "idle",
        "walk_left",
        "walk_right",
        "attack",
        "hit",
        "fall",
        "die",
      ])
        if (!data.animations?.[action]?.frames?.length)
          warnings.push(`${action} animation required`);
      if (!data.animations?.die?.holdLastFrame)
        warnings.push("die must hold last frame");
      if (
        !data.animations?.attack?.frames?.some((f: { events?: string[] }) =>
          f.events?.includes("attack.visual-impact"),
        )
      )
        warnings.push("attack.visual-impact event required");
      for (const [name, anim] of Object.entries(data.animations ?? {}) as [
        string,
        any,
      ][]) {
        if (!anim.frames?.length) warnings.push(`${name}: no frames`);
        if (name.endsWith("_left") && anim.direction !== "left")
          warnings.push(`${name}: direction must be left`);
        if (name.endsWith("_right") && anim.direction !== "right")
          warnings.push(`${name}: direction must be right`);
      }
      for (const f of data.frames ?? []) {
        if (f.reviewRequired && !f.reviewed)
          warnings.push(`${f.id}: automatic crop needs review`);
        if (!f.hurtbox) warnings.push(`${f.id}: hurtbox missing`);
        if (
          f.crop?.x + f.crop?.width > asset!.width ||
          f.crop?.y + f.crop?.height > asset!.height
        )
          warnings.push(`${f.id}: crop exceeds source`);
      }
      if (
        data.character?.element === "unassigned" ||
        data.character?.color === "unassigned"
      )
        warnings.push("Character element and color need manual assignment");
    } else {
      if (!data.groundZones?.length)
        warnings.push("At least one ground zone required");
      if (data.bounds?.left >= data.bounds?.right)
        warnings.push("Invalid movement bounds");
      for (const z of data.groundZones ?? [])
        if (z.left >= z.right) warnings.push("Invalid ground zone bounds");
    }
    const passed = warnings.length === 0;
    await this.s.db.battleAssetValidation.create({
      data: { versionId: version.id, passed, warnings },
    });
    await this.s.db.battleAssetVersion.update({
      where: { id: version.id },
      data: { status: passed ? "READY_FOR_TEST" : "NEEDS_REVIEW" },
    });
    await this.s.db.battleAsset.update({
      where: { id },
      data: { status: passed ? "READY_FOR_TEST" : "NEEDS_REVIEW" },
    });
    return { passed, warnings };
  }
  @Post(":id/approve") async approve(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    const user = await this.s.canManage(req);
    parseId(id);
    const asset = await this.s.db.battleAsset.findUnique({
      where: { id },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    const v = asset?.versions[0];
    if (!v || v.status !== "READY_FOR_TEST")
      err(409, "Validate and test the draft first");
    await this.s.db.battleAssetVersion.update({
      where: { id: v!.id },
      data: { status: "APPROVED" },
    });
    await this.s.db.battleAsset.update({
      where: { id },
      data: { status: "APPROVED" },
    });
    await this.s.db.auditLog.create({
      data: {
        actorId: user.id,
        action: "battle.asset.approve",
        targetId: id,
        metadata: { version: v!.version },
      },
    });
    return { status: "APPROVED" };
  }
  @Post(":id/publish") async publish(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    const user = await this.s.canManage(req);
    parseId(id);
    const asset = await this.s.db.battleAsset.findUnique({
      where: { id },
      include: {
        versions: { orderBy: { version: "desc" }, take: 1 },
        character: true,
        background: true,
      },
    });
    const v = asset?.versions[0];
    if (!asset || !v || v.status !== "APPROVED")
      err(409, "Approved draft required");
    const meta = v!.metadata as Record<string, any>;
    if (asset!.kind === "SPRITE" && !v!.atlasKey) err(409, "Atlas required");
    await this.s.db.$transaction(async (tx) => {
      await tx.battleAssetVersion.updateMany({
        where: { assetId: id, status: "PUBLISHED" },
        data: { status: "ARCHIVED" },
      });
      await tx.battleAssetVersion.update({
        where: { id: v!.id },
        data: {
          status: "PUBLISHED",
          publishedAt: new Date(),
          publishedById: user.id,
        },
      });
      await tx.battleAsset.update({
        where: { id },
        data: { status: "PUBLISHED" },
      });
      if (asset!.kind === "BACKGROUND") {
        await tx.battleBackground.updateMany({ data: { isActive: false } });
        await tx.battleBackground.upsert({
          where: { assetId: id },
          create: { assetId: id, activeVersionId: v!.id, isActive: true },
          update: { activeVersionId: v!.id, isActive: true },
        });
      } else {
        const c = meta.character;
        await tx.battleCharacterDefinition.upsert({
          where: { code: c.code },
          create: {
            code: c.code,
            name: c.name,
            element: c.element,
            color: c.color,
            spawnSide: c.spawnSide,
            assetId: id,
            activeVersionId: v!.id,
          },
          update: {
            name: c.name,
            element: c.element,
            color: c.color,
            spawnSide: c.spawnSide,
            assetId: id,
            activeVersionId: v!.id,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "battle.asset.publish",
          targetId: id,
          metadata: { version: v!.version },
        },
      });
    });
    return { status: "PUBLISHED", version: v!.version };
  }
  @Post(":id/activate") async activate(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    const user = await this.s.canManage(req);
    parseId(id);
    const asset = await this.s.db.battleAsset.findUnique({
      where: { id },
      include: { background: true },
    });
    if (!asset || asset.kind !== "BACKGROUND" || !asset.background)
      return err(404, "Published background not found");
    await this.s.db.$transaction(async (tx) => {
      await tx.battleBackground.updateMany({ data: { isActive: false } });
      await tx.battleBackground.update({
        where: { assetId: id },
        data: { isActive: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "battle.background.activate",
          targetId: id,
        },
      });
    });
    return { active: true };
  }
  @Post(":id/rollback/:version") async rollback(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("version") numberText: string,
  ) {
    const user = await this.s.canManage(req);
    parseId(id);
    const number = Number(numberText);
    if (!Number.isInteger(number) || number < 1) err(400, "Invalid version");
    const asset = await this.s.db.battleAsset.findUnique({
      where: { id },
      include: { character: true, background: true },
    });
    const old = await this.s.db.battleAssetVersion.findUnique({
      where: { assetId_version: { assetId: id, version: number } },
    });
    if (!asset || !old || !old.publishedAt)
      return err(404, "Published version not found");
    await this.s.db.$transaction(async (tx) => {
      await tx.battleAssetVersion.updateMany({
        where: { assetId: id, status: "PUBLISHED" },
        data: { status: "ARCHIVED" },
      });
      await tx.battleAssetVersion.update({
        where: { id: old.id },
        data: { status: "PUBLISHED" },
      });
      if (asset.kind === "BACKGROUND")
        await tx.battleBackground.update({
          where: { assetId: id },
          data: { activeVersionId: old.id },
        });
      else if (asset.character)
        await tx.battleCharacterDefinition.update({
          where: { id: asset.character.id },
          data: { activeVersionId: old.id },
        });
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "battle.asset.rollback",
          targetId: id,
          metadata: { version: number },
        },
      });
    });
    return { status: "PUBLISHED", version: number };
  }
  @Get(":id/file/:file") async file(
    @Req() req: Request,
    @Res() res: Response,
    @Param("id") id: string,
    @Param("file") name: string,
    @Query("version") versionText?: string,
  ) {
    parseId(id);
    const asset = await this.s.db.battleAsset.findUnique({
      where: { id },
      include: { versions: true },
    });
    if (!asset) err(404, "Asset not found");
    const version = versionText
      ? asset!.versions.find((v) => v.version === Number(versionText))
      : asset!.versions.find((v) => v.status === "PUBLISHED");
    const isOriginal = name === "original";
    if (isOriginal || !version || !version.publishedAt)
      await this.s.canManage(req);
    else await this.s.user(req);
    let key: string;
    if (isOriginal || name === "background") key = asset!.originalKey;
    else if (name === "atlas.png" && version?.atlasKey) key = version.atlasKey;
    else if (name === "thumbnail.png") key = `${id}/thumbnail.png`;
    else if (name === "metadata.json" && version)
      key = `${id}/v${version.version}/metadata.json`;
    else if ((name === "atlas.json" || name === "animations.json") && version)
      key = `${id}/v${version.version}/${name}`;
    else if (name === "quality.json" && version)
      key = `${id}/v${version.version}/quality.json`;
    else if (/^frame_[a-zA-Z0-9_-]+\.png$/.test(name) && version)
      key = `${id}/v${version.version}/frames/${name.slice(6)}`;
    else err(404, "File not found");
    res.setHeader(
      "Cache-Control",
      version?.publishedAt
        ? "private, max-age=31536000, immutable"
        : "no-store",
    );
    res.type(
      name.endsWith(".json")
        ? "application/json"
        : isOriginal || name === "background"
          ? asset!.mimeType
          : "image/png",
    );
    return res.sendFile(safeFile(key!));
  }
}
