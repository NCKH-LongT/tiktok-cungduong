-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RoleCode" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'USER', 'VIEWER');

-- CreateEnum
CREATE TYPE "EventSource" AS ENUM ('tiktok', 'simulator');

-- CreateEnum
CREATE TYPE "ChannelStatus" AS ENUM ('stopped', 'connecting', 'connected', 'unavailable');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "RoleCode" NOT NULL DEFAULT 'USER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveChannel" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "uniqueId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ChannelStatus" NOT NULL DEFAULT 'stopped',
    "autoReconnect" BOOLEAN NOT NULL DEFAULT true,
    "lastConnectedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveSession" (
    "id" UUID NOT NULL,
    "liveId" UUID NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "LiveSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveEvent" (
    "id" UUID NOT NULL,
    "eventId" TEXT NOT NULL,
    "liveId" UUID NOT NULL,
    "sessionId" UUID,
    "source" "EventSource" NOT NULL,
    "type" TEXT NOT NULL,
    "userKey" TEXT,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Viewer" (
    "id" UUID NOT NULL,
    "liveId" UUID NOT NULL,
    "userKey" TEXT NOT NULL,
    "nickname" TEXT,
    "avatarUrl" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Viewer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViewerPresence" (
    "id" UUID NOT NULL,
    "viewerId" UUID NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "inferred" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ViewerPresence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftEvent" (
    "id" UUID NOT NULL,
    "liveId" UUID NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "viewerKey" TEXT NOT NULL,
    "nickname" TEXT,
    "giftId" TEXT,
    "giftName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "estimatedCoins" INTEGER,
    "source" "EventSource" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiftEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveRule" (
    "id" UUID NOT NULL,
    "liveId" UUID NOT NULL,
    "triggerType" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "actions" JSONB NOT NULL DEFAULT '[]',
    "cooldownMs" INTEGER NOT NULL DEFAULT 0,
    "priority" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LiveRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIConfiguration" (
    "id" UUID NOT NULL,
    "liveId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "personality" TEXT NOT NULL DEFAULT 'Thân thiện',
    "customPrompt" TEXT,
    "encryptedApiKey" TEXT,
    "cooldownMs" INTEGER NOT NULL DEFAULT 30000,
    "maxPerMinute" INTEGER NOT NULL DEFAULT 10,

    CONSTRAINT "AIConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIInteraction" (
    "id" UUID NOT NULL,
    "liveId" UUID NOT NULL,
    "sourceEventId" TEXT,
    "prompt" TEXT,
    "answer" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpeechJob" (
    "id" UUID NOT NULL,
    "liveId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpeechJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AudioConfiguration" (
    "id" UUID NOT NULL,
    "liveId" UUID NOT NULL,
    "musicUrl" TEXT,
    "musicVolume" INTEGER NOT NULL DEFAULT 30,
    "ttsVolume" INTEGER NOT NULL DEFAULT 80,
    "woodenFishEnabled" BOOLEAN NOT NULL DEFAULT false,
    "woodenFishVolume" INTEGER NOT NULL DEFAULT 30,

    CONSTRAINT "AudioConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SceneConfiguration" (
    "id" UUID NOT NULL,
    "liveId" UUID NOT NULL,
    "maxCharacters" INTEGER NOT NULL DEFAULT 40,
    "inactiveTtlSeconds" INTEGER NOT NULL DEFAULT 900,
    "reducedMotion" BOOLEAN NOT NULL DEFAULT false,
    "theme" TEXT NOT NULL DEFAULT 'temple',

    CONSTRAINT "SceneConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterState" (
    "id" UUID NOT NULL,
    "liveId" UUID NOT NULL,
    "viewerKey" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "seatId" TEXT,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CharacterState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OverlayToken" (
    "id" UUID NOT NULL,
    "liveId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OverlayToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageMetric" (
    "id" UUID NOT NULL,
    "liveId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "periodStart" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserQuota" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "maxLives" INTEGER NOT NULL DEFAULT 3,
    "maxAiPerDay" INTEGER NOT NULL DEFAULT 100,
    "maxTtsPerDay" INTEGER NOT NULL DEFAULT 100,

    CONSTRAINT "UserQuota_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthSession_userId_expiresAt_idx" ON "AuthSession"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "LiveChannel_ownerId_deletedAt_idx" ON "LiveChannel"("ownerId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LiveChannel_ownerId_uniqueId_key" ON "LiveChannel"("ownerId", "uniqueId");

-- CreateIndex
CREATE INDEX "LiveSession_liveId_startedAt_idx" ON "LiveSession"("liveId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LiveEvent_eventId_key" ON "LiveEvent"("eventId");

-- CreateIndex
CREATE INDEX "LiveEvent_liveId_createdAt_idx" ON "LiveEvent"("liveId", "createdAt");

-- CreateIndex
CREATE INDEX "LiveEvent_liveId_type_createdAt_idx" ON "LiveEvent"("liveId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "Viewer_lastSeenAt_idx" ON "Viewer"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "Viewer_liveId_userKey_key" ON "Viewer"("liveId", "userKey");

-- CreateIndex
CREATE INDEX "ViewerPresence_viewerId_enteredAt_idx" ON "ViewerPresence"("viewerId", "enteredAt");

-- CreateIndex
CREATE UNIQUE INDEX "GiftEvent_dedupKey_key" ON "GiftEvent"("dedupKey");

-- CreateIndex
CREATE INDEX "GiftEvent_liveId_source_occurredAt_idx" ON "GiftEvent"("liveId", "source", "occurredAt");

-- CreateIndex
CREATE INDEX "LiveRule_liveId_triggerType_idx" ON "LiveRule"("liveId", "triggerType");

-- CreateIndex
CREATE UNIQUE INDEX "AIConfiguration_liveId_key" ON "AIConfiguration"("liveId");

-- CreateIndex
CREATE INDEX "AIInteraction_liveId_createdAt_idx" ON "AIInteraction"("liveId", "createdAt");

-- CreateIndex
CREATE INDEX "SpeechJob_liveId_status_idx" ON "SpeechJob"("liveId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AudioConfiguration_liveId_key" ON "AudioConfiguration"("liveId");

-- CreateIndex
CREATE UNIQUE INDEX "SceneConfiguration_liveId_key" ON "SceneConfiguration"("liveId");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterState_liveId_viewerKey_key" ON "CharacterState"("liveId", "viewerKey");

-- CreateIndex
CREATE UNIQUE INDEX "OverlayToken_tokenHash_key" ON "OverlayToken"("tokenHash");

-- CreateIndex
CREATE INDEX "OverlayToken_liveId_revokedAt_idx" ON "OverlayToken"("liveId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UsageMetric_liveId_key_periodStart_key" ON "UsageMetric"("liveId", "key", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "UserQuota_userId_key" ON "UserQuota"("userId");

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveChannel" ADD CONSTRAINT "LiveChannel_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveSession" ADD CONSTRAINT "LiveSession_liveId_fkey" FOREIGN KEY ("liveId") REFERENCES "LiveChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveEvent" ADD CONSTRAINT "LiveEvent_liveId_fkey" FOREIGN KEY ("liveId") REFERENCES "LiveChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveEvent" ADD CONSTRAINT "LiveEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LiveSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Viewer" ADD CONSTRAINT "Viewer_liveId_fkey" FOREIGN KEY ("liveId") REFERENCES "LiveChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewerPresence" ADD CONSTRAINT "ViewerPresence_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "Viewer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftEvent" ADD CONSTRAINT "GiftEvent_liveId_fkey" FOREIGN KEY ("liveId") REFERENCES "LiveChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveRule" ADD CONSTRAINT "LiveRule_liveId_fkey" FOREIGN KEY ("liveId") REFERENCES "LiveChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIConfiguration" ADD CONSTRAINT "AIConfiguration_liveId_fkey" FOREIGN KEY ("liveId") REFERENCES "LiveChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIInteraction" ADD CONSTRAINT "AIInteraction_liveId_fkey" FOREIGN KEY ("liveId") REFERENCES "LiveChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeechJob" ADD CONSTRAINT "SpeechJob_liveId_fkey" FOREIGN KEY ("liveId") REFERENCES "LiveChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudioConfiguration" ADD CONSTRAINT "AudioConfiguration_liveId_fkey" FOREIGN KEY ("liveId") REFERENCES "LiveChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SceneConfiguration" ADD CONSTRAINT "SceneConfiguration_liveId_fkey" FOREIGN KEY ("liveId") REFERENCES "LiveChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterState" ADD CONSTRAINT "CharacterState_liveId_fkey" FOREIGN KEY ("liveId") REFERENCES "LiveChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OverlayToken" ADD CONSTRAINT "OverlayToken_liveId_fkey" FOREIGN KEY ("liveId") REFERENCES "LiveChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageMetric" ADD CONSTRAINT "UsageMetric_liveId_fkey" FOREIGN KEY ("liveId") REFERENCES "LiveChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserQuota" ADD CONSTRAINT "UserQuota_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
