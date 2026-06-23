import { NextResponse } from 'next/server';
import { getSessionUser, requireUser } from '@/lib/auth';
import { createLocalUser, readStore, publicUser } from '@/lib/localDb';
import { writeAudit } from '@/lib/audit';

export async function GET() {
  try {
    const session = await requireUser();
    const store = await readStore();

    let users = store.app_users.map(publicUser).sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));

    // Recall staff should not need full user management rights just to load the Calling List.
    // They only receive their own user record, while admin/manager/finance/viewer can see the directory.
    if (session.role === 'recall_staff') {
      users = users.filter((u: any) => u.id === session.id);
    }

    return NextResponse.json({ users, me: session });
  } catch (error: any) {
    const status = error.message === 'UNAUTHENTICATED' ? 401 : error.message === 'FORBIDDEN' ? 403 : 500;
    return NextResponse.json({ error: error.message || 'Failed to load users' }, { status });
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(['admin']);
    const body = await req.json();
    const created = await createLocalUser({ name: body.name, email: body.email, role: body.role, password: body.password || 'ChangeMe123!' });
    await writeAudit(user.id, 'CREATE_USER', 'app_user', created.id, { email: created.email, role: created.role });
    return NextResponse.json({ user: created });
  } catch (error: any) {
    const status = error.message === 'UNAUTHENTICATED' ? 401 : error.message === 'FORBIDDEN' ? 403 : String(error.message || '').includes('already exists') ? 409 : 500;
    return NextResponse.json({ error: error.message || 'Failed to create user' }, { status });
  }
}
