import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decryptGeminiKey, encryptGeminiKey } from '@cd/shared/gemini-key';

test('Gemini key is encrypted, decryptable, and authenticated', () => {
  const secret = '0123456789abcdef0123456789abcdef';
  const key = 'AIza-example-private-gemini-key';
  const encrypted = encryptGeminiKey(key, secret);
  assert.ok(!encrypted.includes(key));
  assert.equal(decryptGeminiKey(encrypted, secret), key);
  assert.throws(() => decryptGeminiKey(encrypted, 'different-0123456789abcdef0123456789'), /authenticate|Unsupported|Invalid/);
  assert.throws(() => encryptGeminiKey(key, ''), /ENCRYPTION_KEY/);
});
