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
    console.log('Bootstrap admin ready');
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error); process.exit(1); });
