ALTER TABLE "LiveSession" ADD COLUMN "roomId" TEXT;
CREATE INDEX "LiveSession_liveId_roomId_idx" ON "LiveSession"("liveId", "roomId");
