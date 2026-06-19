import { NextResponse } from 'next/server';
import { cookieName } from '@/lib/auth';

function expireSessionCookie(response: NextResponse) {
  const options = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
    expires: new Date(0)
  };

  response.cookies.set(cookieName, '', options);
  response.cookies.delete(cookieName);
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('Expires', '0');
  return response;
}

export async function GET(req: Request) {
  const url = new URL('/login', req.url);
  url.searchParams.set('loggedOut', '1');
  url.searchParams.set('t', String(Date.now()));
  const response = NextResponse.redirect(url, { status: 303 });
  return expireSessionCookie(response);
}

export async function POST(req: Request) {
  const url = new URL('/login', req.url);
  url.searchParams.set('loggedOut', '1');
  const response = NextResponse.redirect(url, { status: 303 });
  return expireSessionCookie(response);
}
