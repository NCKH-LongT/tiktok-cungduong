-- CreateEnum
CREATE TYPE "BattleAssetKind" AS ENUM ('BACKGROUND', 'SPRITE');

-- CreateEnum
CREATE TYPE "BattleAssetStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'NEEDS_REVIEW', 'DRAFT', 'READY_FOR_TEST', 'APPROVED', 'PUBLISHED', 'ARCHIVED', 'FAILED');

-- CreateTable
CREATE TABLE "BattleAsset" (
    "id" UUID NOT NULL,
    "kind" "BattleAssetKind" NOT NULL,
    "name" TEXT NOT NULL,
    "originalKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "status" "BattleAssetStatus" NOT NULL DEFAULT 'UPLOADED',
    "ownerId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BattleAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BattleAssetVersion" (
    "id" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "BattleAssetStatus" NOT NULL DEFAULT 'DRAFT',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "atlasKey" TEXT,
    "checksum" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "publishedById" UUID,

    CONSTRAINT "BattleAssetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BattleCharacterDefinition" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "element" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "spawnSide" TEXT NOT NULL,
    "assetId" UUID,
    "activeVersionId" UUID,

    CONSTRAINT "BattleCharacterDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BattleBackground" (
    "id" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "activeVersionId" UUID,

    CONSTRAINT "BattleBackground_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BattleAnimation" (
    "id" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "BattleAnimation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BattleAnimationFrame" (
    "id" UUID NOT NULL,
    "animationId" UUID NOT NULL,
    "frameId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "events" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "BattleAnimationFrame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BattleAssetValidation" (
    "id" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BattleAssetValidation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BattleAsset_originalKey_key" ON "BattleAsset"("originalKey");

-- CreateIndex
CREATE INDEX "BattleAssetVersion_status_publishedAt_idx" ON "BattleAssetVersion"("status", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BattleAssetVersion_assetId_version_key" ON "BattleAssetVersion"("assetId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "BattleCharacterDefinition_code_key" ON "BattleCharacterDefinition"("code");

-- CreateIndex
CREATE UNIQUE INDEX "BattleCharacterDefinition_assetId_key" ON "BattleCharacterDefinition"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "BattleBackground_assetId_key" ON "BattleBackground"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "BattleAnimation_versionId_name_key" ON "BattleAnimation"("versionId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "BattleAnimationFrame_animationId_ordinal_key" ON "BattleAnimationFrame"("animationId", "ordinal");

-- AddForeignKey
ALTER TABLE "BattleAsset" ADD CONSTRAINT "BattleAsset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BattleAssetVersion" ADD CONSTRAINT "BattleAssetVersion_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "BattleAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BattleCharacterDefinition" ADD CONSTRAINT "BattleCharacterDefinition_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "BattleAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BattleBackground" ADD CONSTRAINT "BattleBackground_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "BattleAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BattleAnimation" ADD CONSTRAINT "BattleAnimation_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "BattleAssetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BattleAnimationFrame" ADD CONSTRAINT "BattleAnimationFrame_animationId_fkey" FOREIGN KEY ("animationId") REFERENCES "BattleAnimation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BattleAssetValidation" ADD CONSTRAINT "BattleAssetValidation_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "BattleAssetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
