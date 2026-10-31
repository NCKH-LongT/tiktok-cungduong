CREATE INDEX "LiveEvent_liveId_sessionId_source_type_createdAt_idx"
ON "LiveEvent"("liveId", "sessionId", "source", "type", "createdAt");
