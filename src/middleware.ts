import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const sessionCookie = request.cookies.get('session')?.value;
  const url = request.nextUrl.clone();

  const isRootPath = url.pathname === '/';
  const isDashboardPath = url.pathname.startsWith('/dashboard');
  const isTradePath = url.pathname.startsWith('/trade');
  const isLoginPath = url.pathname === '/login';

  if (!sessionCookie && (isRootPath || isDashboardPath || isTradePath)) {
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (sessionCookie && isLoginPath) {
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/',
    '/dashboard/:path*',
    '/login',
    '/trade/:path*',
  ],
};
