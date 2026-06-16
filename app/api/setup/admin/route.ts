import { NextResponse } from 'next/server';
import { createLocalUser, readStore } from '@/lib/localDb';
import { writeAudit } from '@/lib/audit';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const expectedKey = process.env.ADMIN_SETUP_KEY || 'fhdc-admin-setup-2026';
    if (String(body.setupKey || '') !== expectedKey) {
      return NextResponse.json({ error: 'Invalid admin setup key. Use fhdc-admin-setup-2026 unless you changed it.' }, { status: 403 });
    }

    const store = await readStore();
    if (store.app_users.length > 0) {
      return NextResponse.json({ error: 'Admin setup is closed because users already exist' }, { status: 409 });
    }

    const user = await createLocalUser({ name: body.name, email: body.email, role: 'admin', password: body.password });
    await writeAudit(user.id, 'CREATE_FIRST_ADMIN', 'app_user', user.id, { email: user.email });
    return NextResponse.json({ user });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to create admin' }, { status: 500 });
  }
}
