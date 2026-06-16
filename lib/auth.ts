import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import { readStore, type AppRole, publicUser } from './localDb';

export type { AppRole } from './localDb';

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: AppRole;
};

const cookieName = 'fhdc_recalldesk_session';

function getSecret() {
  const secret = process.env.APP_SESSION_SECRET || 'fhdc-recalldesk-local-development-secret-2026';
  return new TextEncoder().encode(secret);
}

export async function createSession(user: SessionUser) {
  const token = await new SignJWT(user as any)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(getSecret());

  const cookieStore = await cookies();
  cookieStore.set(cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12
  });
}

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.set(cookieName, '', { path: '/', maxAge: 0 });
}

export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(cookieName)?.value;
    if (!token) return null;
    const verified = await jwtVerify(token, getSecret());
    const payload = verified.payload as any;
    if (!payload?.id || !payload?.email) return null;

    const store = await readStore();
    const user = store.app_users.find(u => u.id === payload.id && u.is_active);
    if (!user) return null;
    const safe = publicUser(user) as SessionUser;
    return { id: safe.id, name: safe.name, email: safe.email, role: safe.role };
  } catch {
    return null;
  }
}

export async function requireUser(allowedRoles?: AppRole[]) {
  const user = await getSessionUser();
  if (!user) throw new Error('UNAUTHENTICATED');
  if (allowedRoles && !allowedRoles.includes(user.role)) throw new Error('FORBIDDEN');
  return user;
}

export function canManage(role: AppRole) {
  return ['admin', 'manager'].includes(role);
}

export function canManagePayments(role: AppRole) {
  return ['admin', 'manager', 'finance'].includes(role);
}
