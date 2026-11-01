import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

async function main() {
  const db = new PrismaClient();
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 16) {
    throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD (at least 16 characters) before bootstrap');
  }
  try {
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    await db.user.upsert({
      where: { email },
      create: { email, username: email.split('@')[0], passwordHash: hash, role: 'SUPER_ADMIN' },
      update: {},
    });
    const permission = await db.permission.upsert({
      where: { code: 'battle.assets.manage' },
      create: { code: 'battle.assets.manage' },
      update: {},
    });
    const adminRole = await db.role.upsert({
      where: { code: 'ADMIN' },
      create: { code: 'ADMIN', name: 'Administrator' },
      update: {},
    });
    await db.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: adminRole.id, permissionId: permission.id } },
      create: { roleId: adminRole.id, permissionId: permission.id },
      update: {},
    });
    console.log('Bootstrap admin ready');
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error); process.exit(1); });
