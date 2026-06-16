import { NextResponse } from 'next/server';
import { clearSession, getSessionUser } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';

export async function POST() {
  const user = await getSessionUser();
  await clearSession();
  if (user) await writeAudit(user.id, 'LOGOUT', 'app_user', user.id, {});
  return NextResponse.json({ ok: true });
}
