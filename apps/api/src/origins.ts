export function configuredOrigins(value: string): string[] {
  return value.split(',').map(entry => {
    const url = new URL(entry.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('CORS origins must use HTTP or HTTPS');
    return url.origin;
  });
}
