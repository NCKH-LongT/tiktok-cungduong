CREATE TABLE "BattleLiveConfiguration" (
    "liveId" UUID NOT NULL,
    "leftAssetId" UUID NOT NULL,
    "leftVersion" INTEGER NOT NULL,
    "rightAssetId" UUID NOT NULL,
    "rightVersion" INTEGER NOT NULL,
    "backgroundAssetId" UUID,
    "backgroundVersion" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BattleLiveConfiguration_pkey" PRIMARY KEY ("liveId")
);

ALTER TABLE "BattleLiveConfiguration" ADD CONSTRAINT "BattleLiveConfiguration_liveId_fkey"
    FOREIGN KEY ("liveId") REFERENCES "LiveChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
