import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { readStore } from '@/lib/localDb';
import { createSession } from '@/lib/auth';
import { writeAudit } from '@/lib/audit';

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();
    const store = await readStore();
    const user = store.app_users.find(u => u.email === String(email || '').trim().toLowerCase());

    if (!user || !user.is_active) return NextResponse.json({ error: 'Invalid login details' }, { status: 401 });

    const ok = await bcrypt.compare(String(password || ''), user.password_hash);
    if (!ok) return NextResponse.json({ error: 'Invalid login details' }, { status: 401 });

    await createSession({ id: user.id, name: user.name, email: user.email, role: user.role });
    await writeAudit(user.id, 'LOGIN', 'app_user', user.id, {});
    return NextResponse.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Login failed' }, { status: 500 });
  }
}
