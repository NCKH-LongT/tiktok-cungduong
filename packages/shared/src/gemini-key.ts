import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function secretKey(secret: string | undefined): Buffer {
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) throw new Error('ENCRYPTION_KEY must contain at least 32 bytes');
  return createHash('sha256').update(secret, 'utf8').digest();
}

export function encryptGeminiKey(apiKey: string, secret: string | undefined): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secretKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join(':');
}

export function decryptGeminiKey(value: string, secret: string | undefined): string {
  const [version, iv, tag, encrypted, extra] = value.split(':');
  if (version !== 'v1' || !iv || !tag || !encrypted || extra) throw new Error('Invalid encrypted Gemini key');
  const decipher = createDecipheriv('aes-256-gcm', secretKey(secret), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
}
