import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { requireUser } from '@/lib/auth';
import { updateStoreFresh, publicUser, nowIso, type AppRole } from '@/lib/localDb';
import { writeAudit } from '@/lib/audit';
import { useTableStorage, updateUser as updateTableUser, deleteUser as deleteTableUser } from '@/lib/tableDb';

const validRoles: AppRole[] = ['admin', 'manager', 'recall_staff', 'verifier', 'finance', 'viewer'];
type RouteContext = { params: Promise<{ id: string }> | { id: string } };
async function getParams(context: RouteContext) { return await context.params; }

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const session = await requireUser(['admin']);
    const { id } = await getParams(context);
    const body = await req.json();
    const updated = useTableStorage() ? await updateTableUser(session, id, body) : await updateStoreFresh(async store => {
      const target = store.app_users.find(u => u.id === id);
      if (!target) throw new Error('User not found');
      const isSelf = target.id === session.id;
      const nextName = typeof body.name === 'string' ? body.name.trim() : target.name;
      const nextEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : target.email;
      const nextRole = typeof body.role === 'string' ? body.role : target.role;
      const nextActive = typeof body.is_active === 'boolean' ? body.is_active : target.is_active;
      const nextPassword = typeof body.password === 'string' ? body.password : '';
      if (!nextName) throw new Error('Name is required');
      if (!nextEmail) throw new Error('Email is required');
      if (!validRoles.includes(nextRole as AppRole)) throw new Error('Invalid role selected');
      if (store.app_users.some(u => u.id !== target.id && u.email.toLowerCase() === nextEmail)) throw new Error('Another user already has that email address');
      if (isSelf && nextRole !== target.role) throw new Error('You cannot change your own role while signed in');
      if (isSelf && nextActive === false) throw new Error('You cannot deactivate your own account while signed in');
      target.name = nextName; target.email = nextEmail; target.role = nextRole as AppRole; target.is_active = nextActive; (target as any).updated_at = nowIso();
      if (nextPassword.trim()) { if (nextPassword.trim().length < 8) throw new Error('New password must be at least 8 characters'); target.password_hash = await bcrypt.hash(nextPassword.trim(), 12); }
      return publicUser(target);
    });
    await writeAudit(session.id, 'UPDATE_USER', 'app_user', id, { email: updated.email, role: updated.role, is_active: updated.is_active, password_reset: Boolean(body.password) });
    return NextResponse.json({ user: updated });
  } catch (error: any) {
    const status = error.message === 'UNAUTHENTICATED' ? 401 : error.message === 'FORBIDDEN' ? 403 : error.message === 'User not found' ? 404 : 400;
    return NextResponse.json({ error: error.message || 'Failed to update user' }, { status });
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const session = await requireUser(['admin']);
    const { id } = await getParams(context);
    const result = useTableStorage() ? await deleteTableUser(session, id) : await updateStoreFresh(store => {
      const target = store.app_users.find(u => u.id === id);
      if (!target) throw new Error('User not found');
      if (target.id === session.id) throw new Error('You cannot delete your own account while signed in');
      store.patient_master.forEach((p: any) => { if (p.assigned_to === target.id && p.assignment_status === 'assigned') { p.assigned_to = null; p.assignment_status = 'unassigned'; } });
      store.app_users = store.app_users.filter(u => u.id !== target.id);
      return { deletedUser: publicUser(target), unassignedPatients: 0, preservedCallLogs: 0, preservedBookings: 0 };
    });
    await writeAudit(session.id, 'DELETE_USER', 'app_user', id, result);
    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    const status = error.message === 'UNAUTHENTICATED' ? 401 : error.message === 'FORBIDDEN' ? 403 : error.message === 'User not found' ? 404 : 400;
    return NextResponse.json({ error: error.message || 'Failed to delete user' }, { status });
  }
}
