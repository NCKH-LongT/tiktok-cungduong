const TEST_SITE_KEY = '1x00000000000000000000AA';
const TEST_SECRET_KEY = '1x0000000000000000000000000000000AA';

export function turnstileKeys(env: NodeJS.ProcessEnv = process.env) {
  const hostname = new URL(env.PUBLIC_APP_URL ?? 'http://localhost').hostname;
  const localTest = env.LOCAL_TURNSTILE_TEST === 'true' && (hostname === 'localhost' || hostname === '127.0.0.1');
  return {
    siteKey: localTest ? TEST_SITE_KEY : env.TURNSTILE_SITE_KEY ?? '',
    secretKey: localTest ? TEST_SECRET_KEY : env.TURNSTILE_SECRET_KEY ?? '',
  };
}
