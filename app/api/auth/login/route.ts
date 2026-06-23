import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { readStore } from '@/lib/localDb';
import { createSession } from '@/lib/auth';
import { useTableStorage, getUserByEmail } from '@/lib/tableDb';

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();
    const cleanedEmail = String(email || '').trim().toLowerCase();
    const user = useTableStorage()
      ? await getUserByEmail(cleanedEmail)
      : (await readStore()).app_users.find(u => u.email === cleanedEmail);

    if (!user || !user.is_active) return NextResponse.json({ error: 'Invalid login details' }, { status: 401 });
    const ok = await bcrypt.compare(String(password || ''), user.password_hash);
    if (!ok) return NextResponse.json({ error: 'Invalid login details' }, { status: 401 });
    await createSession({ id: user.id, name: user.name, email: user.email, role: user.role });
    const response = NextResponse.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Login failed' }, { status: 500 });
  }
}
