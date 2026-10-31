import { randomInt } from 'node:crypto';
import { PayOS } from '@payos/node';
import { Prisma, PrismaClient } from '@prisma/client';

export const DAY_PASS_VND = 50000;

export function payOSClient(): PayOS | null {
  const { PAYOS_CLIENT_ID: clientId, PAYOS_API_KEY: apiKey, PAYOS_CHECKSUM_KEY: checksumKey } = process.env;
  return clientId && apiKey && checksumKey ? new PayOS({ clientId, apiKey, checksumKey, timeout: 10000, maxRetries: 0 }) : null;
}

export function newOrderCode(): bigint {
  return BigInt(Date.now() * 1000 + randomInt(1000));
}

export async function settlePaidOrder(db: PrismaClient, orderCode: bigint, amountPaid: number, paymentLinkId?: string): Promise<boolean> {
  return db.$transaction(async tx => {
    const order = await tx.paymentOrder.findUnique({ where: { orderCode } });
    if (!order || order.amount !== DAY_PASS_VND || amountPaid < order.amount) return false;
    if (order.paymentLinkId && paymentLinkId && order.paymentLinkId !== paymentLinkId) return false;
    const updated = await tx.paymentOrder.updateMany({ where: { id: order.id, status: 'PENDING' }, data: { status: 'PAID', paidAt: new Date(), ...(paymentLinkId && !order.paymentLinkId ? { paymentLinkId } : {}) } });
    if (!updated.count) return order.status === 'PAID';
    await tx.$executeRaw`UPDATE "User" SET "accessUntil" = GREATEST(COALESCE("accessUntil", NOW()), NOW()) + INTERVAL '1 day' WHERE "id" = ${order.userId}::uuid`;
    return true;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
