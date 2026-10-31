import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = (await cookies()).get('sid')?.value;
  if (!session) redirect('/');

  let role: string | undefined;
  try {
    const response = await fetch(`${process.env.API_INTERNAL_URL ?? 'http://localhost:3001'}/auth/me`, {
      headers: { cookie: `sid=${session}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) role = (await response.json() as { role?: string }).role;
  } catch {
    // Fail closed when the API cannot validate the session.
  }
  if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') redirect('/');
  return children;
}
