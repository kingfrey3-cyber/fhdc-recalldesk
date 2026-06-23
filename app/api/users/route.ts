import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { createLocalUser, readStoreFresh, publicUser } from '@/lib/localDb';
import { writeAudit } from '@/lib/audit';
import { useTableStorage, listUsers, createUser } from '@/lib/tableDb';

export async function GET() {
  try {
    const session = await requireUser();
    const users = useTableStorage()
      ? await listUsers(session)
      : (await readStoreFresh()).app_users.map(publicUser).filter((u: any) => session.role !== 'recall_staff' || u.id === session.id).sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
    return NextResponse.json({ users, me: session });
  } catch (error: any) {
    const status = error.message === 'UNAUTHENTICATED' ? 401 : error.message === 'FORBIDDEN' ? 403 : 500;
    return NextResponse.json({ error: error.message || 'Failed to load users' }, { status });
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireUser(['admin']);
    const body = await req.json();
    const created = useTableStorage()
      ? await createUser({ name: body.name, email: body.email, role: body.role, password: body.password || 'ChangeMe123!' })
      : await createLocalUser({ name: body.name, email: body.email, role: body.role, password: body.password || 'ChangeMe123!' });
    await writeAudit(session.id, 'CREATE_USER', 'app_user', created.id, { email: created.email, role: created.role });
    return NextResponse.json({ user: created });
  } catch (error: any) {
    const status = error.message === 'UNAUTHENTICATED' ? 401 : error.message === 'FORBIDDEN' ? 403 : error.message.includes('already') ? 409 : 400;
    return NextResponse.json({ error: error.message || 'Failed to create user' }, { status });
  }
}
