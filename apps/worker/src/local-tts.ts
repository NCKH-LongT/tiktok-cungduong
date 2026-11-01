export async function synthesizeLocalSpeech(url: string, text: string, speed: number): Promise<string> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, speed }),
    signal: AbortSignal.timeout(240000),
  });
  if (!response.ok) throw new Error(`Local TTS returned ${response.status}`);
  if (!response.headers.get('content-type')?.startsWith('audio/mpeg')) throw new Error('Local TTS returned non-audio content');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!isValidMp3(bytes)) throw new Error(`Invalid local TTS MP3: ${bytes.length} bytes`);
  return bytes.toString('base64');
}

export function isValidMp3(bytes: Buffer): boolean {
  return bytes.length >= 100 && bytes.length <= 5_000_000 && (
    bytes.subarray(0, 3).toString() === 'ID3' ||
    (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  );
}
