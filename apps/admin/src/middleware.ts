import type { NextRequest } from 'next/server';
import { MOCK_MODE, SUPABASE_CONFIGURED } from './lib/env';
import { updateSession } from './lib/supabase/middleware';
import { NextResponse } from 'next/server';

export async function middleware(request: NextRequest) {
  // With no project configured, or in mock mode, let the page itself explain
  // what is missing instead of redirecting into a sign-in form that cannot work.
  if (MOCK_MODE || !SUPABASE_CONFIGURED) return NextResponse.next({ request });
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Every route except Next's own assets and static files. The sign-in page
     * is matched too, so an already signed-in admin gets a refreshed session
     * there as well.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
