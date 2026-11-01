import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";

const root = path.resolve(
  process.env.BATTLE_ASSET_ROOT ?? "/var/lib/cungduong/battle-assets",
);
const script = path.resolve(
  process.env.BATTLE_PROCESSOR_PATH ?? "/app/apps/sprite-worker/processor.py",
);
const db = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});
const queue = new Queue("battle-assets", { connection: redis });
function file(...parts: string[]) {
  const result = path.resolve(root, ...parts);
  if (!result.startsWith(root + path.sep)) throw new Error("Unsafe asset path");
  return result;
}
async function processImage(
  mode: "inspect" | "render",
  source: string,
  config: string,
  output: string,
) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const child = spawn("python3", [script, mode, source, config, output], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", PYTHONUNBUFFERED: "1" },
    });
    let stdout = "",
      stderr = "";
    const timeout = setTimeout(() => child.kill("SIGKILL"), 60000);
    child.stdout.on("data", (b: Buffer) => {
      stdout += b.toString().slice(0, 200000);
    });
    child.stderr.on("data", (b: Buffer) => {
      stderr += b.toString().slice(0, 20000);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0)
        reject(
          new Error(
            `Sprite processor failed (${code}): ${stderr.slice(0, 1000)}`,
          ),
        );
      else {
        try {
          resolve(JSON.parse(stdout));
        } catch (error) {
          reject(error);
        }
      }
    });
  });
}
const worker = new Worker(
  "battle-assets",
  async (job) => {
    const assetId = String(job.data.assetId);
    const asset = await db.battleAsset.findUnique({
      where: { id: assetId },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    if (!asset) return;
    if (job.name === "inspect" && ["PUBLISHED", "ARCHIVED", "APPROVED"].includes(asset.versions[0]?.status ?? ""))
      return;
    const source = file(asset.originalKey);
    try {
      if (job.name === "inspect") {
        await db.battleAsset.update({
          where: { id: assetId },
          data: { status: "PROCESSING" },
        });
        const report = await processImage(
          "inspect",
          source,
          "-",
          file(assetId),
        );
        await db.battleAsset.update({
          where: { id: assetId },
          data: {
            width: Number(report.width),
            height: Number(report.height),
            status: "NEEDS_REVIEW",
          },
        });
        const latest = await db.battleAssetVersion.findUniqueOrThrow({
          where: { id: asset.versions[0].id },
        });
        const { draft, ...inspection } = report;
        const existing = latest.metadata as Record<string, unknown>;
        const canAutoDraft = !!draft && !Array.isArray(existing.frames) &&
          !["PUBLISHED", "ARCHIVED", "APPROVED"].includes(latest.status);
        await db.battleAssetVersion.update({
          where: { id: latest.id },
          data: {
            status: "NEEDS_REVIEW",
            metadata: canAutoDraft
              ? { ...(draft as object), inspection } as Prisma.InputJsonValue
              : { ...existing, inspection } as Prisma.InputJsonValue,
          },
        });
        if (canAutoDraft) {
          await queue.add("render", { assetId, versionId: latest.id },
            { attempts: 1, removeOnComplete: 100, removeOnFail: 100 });
        }
        return {
          candidateCount: (report.candidates as unknown[])?.length ?? 0,
          autoDrafted: canAutoDraft,
        };
      }
      if (job.name === "render") {
        const version = await db.battleAssetVersion.findUnique({
          where: { id: String(job.data.versionId) },
        });
        if (
          !version ||
          version.assetId !== assetId ||
          version.status === "PUBLISHED" ||
          version.status === "ARCHIVED"
        )
          return;
        const directory = file(assetId, `v${version.version}`);
        await rm(directory, { recursive: true, force: true });
        await mkdir(directory, { recursive: true });
        const draftFile = path.join(directory, "draft.json");
        await writeFile(draftFile, JSON.stringify(version.metadata));
        const result = await processImage(
          "render",
          source,
          draftFile,
          directory,
        );
        const atlas = await readFile(path.join(directory, "atlas.png"));
        await db.battleAssetVersion.update({
          where: { id: version.id },
          data: {
            status: "NEEDS_REVIEW",
            atlasKey: `${assetId}/v${version.version}/atlas.png`,
            checksum: createHash("sha256").update(atlas).digest("hex"),
          },
        });
        await db.battleAsset.update({
          where: { id: assetId },
          data: { status: "NEEDS_REVIEW" },
        });
        return result;
      }
      throw new Error("Unsupported battle job");
    } catch (error) {
      console.error("Battle asset processing failed", assetId, error);
      await db.battleAsset.update({
        where: { id: assetId },
        data: { status: "FAILED" },
      });
      if (job.data.versionId)
        await db.battleAssetVersion.updateMany({
          where: {
            id: String(job.data.versionId),
            status: { not: "PUBLISHED" },
          },
          data: { status: "FAILED" },
        });
      throw error;
    }
  },
  { connection: redis, concurrency: 1 },
);
worker.on("failed", (job, error) =>
  console.error("Battle asset job failed", job?.id, error.message),
);
async function shutdown() {
  await worker.close();
  await queue.close();
  await redis.quit();
  await db.$disconnect();
  process.exit(0);
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
