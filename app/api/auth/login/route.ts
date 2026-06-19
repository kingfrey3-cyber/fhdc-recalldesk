import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { readStore } from '@/lib/localDb';
import { createSession } from '@/lib/auth';

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();
    const store = await readStore();
    const user = store.app_users.find(u => u.email === String(email || '').trim().toLowerCase());

    if (!user || !user.is_active) return NextResponse.json({ error: 'Invalid login details' }, { status: 401 });

    const ok = await bcrypt.compare(String(password || ''), user.password_hash);
    if (!ok) return NextResponse.json({ error: 'Invalid login details' }, { status: 401 });

    await createSession({ id: user.id, name: user.name, email: user.email, role: user.role });

    // Do not write a LOGIN audit record in the current single-JSON Supabase bridge.
    // Writing the full app store during login is what made sign-in slow and sometimes caused 502/503 responses.
    // Operational actions such as uploads, assignments, calls and user edits remain traceable in their modules.
    const response = NextResponse.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Login failed' }, { status: 500 });
  }
}
