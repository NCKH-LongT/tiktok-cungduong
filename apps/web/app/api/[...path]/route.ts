import { NextRequest, NextResponse } from 'next/server';

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const upstream = new URL(`${process.env.API_INTERNAL_URL ?? 'http://localhost:3001'}/${path.join('/')}`);
  upstream.search = request.nextUrl.search;
  const headers = new Headers(request.headers);
  headers.delete('host'); headers.delete('content-length');
  const response = await fetch(upstream, { method: request.method, headers, body: ['GET','HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(), cache: 'no-store', redirect: 'manual' });
  const outgoing = new NextResponse(response.body, { status: response.status });
  for (const [key, value] of response.headers) if (!['content-encoding','transfer-encoding','content-length'].includes(key.toLowerCase())) outgoing.headers.append(key, value);
  return outgoing;
}
export const GET = proxy; export const POST = proxy; export const PUT = proxy; export const PATCH = proxy; export const DELETE = proxy;
