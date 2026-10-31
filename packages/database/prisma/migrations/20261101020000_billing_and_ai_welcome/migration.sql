ALTER TABLE "User" ADD COLUMN "accessUntil" TIMESTAMP(3);

CREATE TABLE "PaymentOrder" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "orderCode" BIGINT NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 50000,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "checkoutUrl" TEXT,
    "paymentLinkId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    CONSTRAINT "PaymentOrder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PaymentOrder_orderCode_key" ON "PaymentOrder"("orderCode");
CREATE INDEX "PaymentOrder_userId_createdAt_idx" ON "PaymentOrder"("userId", "createdAt");
ALTER TABLE "PaymentOrder" ADD CONSTRAINT "PaymentOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AIWelcome" (
    "liveId" UUID NOT NULL,
    "roomKey" TEXT NOT NULL,
    "userKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AIWelcome_pkey" PRIMARY KEY ("liveId", "roomKey", "userKey")
);
ALTER TABLE "AIWelcome" ADD CONSTRAINT "AIWelcome_liveId_fkey" FOREIGN KEY ("liveId") REFERENCES "LiveChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
