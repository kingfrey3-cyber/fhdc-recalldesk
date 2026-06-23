import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { requireUser } from '@/lib/auth';
import { updateStore, publicUser, nowIso, type AppRole } from '@/lib/localDb';
import { writeAudit } from '@/lib/audit';

const validRoles: AppRole[] = ['admin', 'manager', 'recall_staff', 'verifier', 'finance', 'viewer'];

type RouteContext = { params: Promise<{ id: string }> | { id: string } };

async function getParams(context: RouteContext) {
  return await context.params;
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const session = await requireUser(['admin']);
    const { id } = await getParams(context);
    const body = await req.json();

    const updated = await updateStore(async store => {
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
      if (store.app_users.some(u => u.id !== target.id && u.email.toLowerCase() === nextEmail)) {
        throw new Error('Another user already has that email address');
      }

      if (isSelf && nextRole !== target.role) throw new Error('You cannot change your own role while signed in');
      if (isSelf && nextActive === false) throw new Error('You cannot deactivate your own account while signed in');

      const activeAdmins = store.app_users.filter(u => u.role === 'admin' && u.is_active && u.id !== target.id).length;
      const wouldRemainAdmin = nextRole === 'admin' && nextActive;
      if (target.role === 'admin' && !wouldRemainAdmin && activeAdmins < 1) {
        throw new Error('At least one active admin account must remain');
      }

      target.name = nextName;
      target.email = nextEmail;
      target.role = nextRole as AppRole;
      target.is_active = nextActive;
      (target as any).updated_at = nowIso();

      if (nextPassword.trim()) {
        if (nextPassword.trim().length < 8) throw new Error('New password must be at least 8 characters');
        target.password_hash = await bcrypt.hash(nextPassword.trim(), 12);
        (target as any).password_reset_at = nowIso();
      }

      return publicUser(target);
    });

    await writeAudit(session.id, 'UPDATE_USER', 'app_user', id, {
      email: updated.email,
      role: updated.role,
      is_active: updated.is_active,
      password_reset: Boolean(body.password)
    });

    return NextResponse.json({ user: updated });
  } catch (error: any) {
    const status = error.message === 'UNAUTHENTICATED' ? 401 : error.message === 'FORBIDDEN' ? 403 : 400;
    return NextResponse.json({ error: error.message || 'Failed to update user' }, { status });
  }
}


export async function DELETE(req: Request, context: RouteContext) {
  try {
    const session = await requireUser(['admin']);
    const { id } = await getParams(context);

    const deleted = await updateStore(async store => {
      const target = store.app_users.find(u => u.id === id);
      if (!target) throw new Error('User not found');
      if (target.id === session.id) throw new Error('You cannot delete your own account while signed in');

      const activeAdminsAfterDelete = store.app_users.filter(u => u.role === 'admin' && u.is_active && u.id !== target.id).length;
      if (target.role === 'admin' && activeAdminsAfterDelete < 1) {
        throw new Error('At least one active admin account must remain');
      }

      const snapshot = { id: target.id, name: target.name, email: target.email, role: target.role, deleted_at: nowIso(), deleted_by: session.id };

      // Unassign pending work from deleted users so patients do not get trapped under a duplicate/incorrect account.
      let unassignedPatients = 0;
      for (const patient of store.patient_master as any[]) {
        if (patient.assigned_to === target.id) {
          patient.assigned_to = null;
          if (patient.assignment_status === 'assigned') patient.assignment_status = 'unassigned';
          patient.updated_at = nowIso();
          unassignedPatients += 1;
        }
      }

      // Preserve a readable snapshot on historical records before removing the user login.
      for (const call of store.call_attempts as any[]) {
        if (call.staff_id === target.id) {
          call.staff_name_snapshot = target.name;
          call.staff_email_snapshot = target.email;
        }
      }
      for (const booking of store.bookings as any[]) {
        if (booking.staff_id === target.id) {
          booking.staff_name_snapshot = target.name;
          booking.staff_email_snapshot = target.email;
        }
      }
      for (const calc of store.staff_payment_calculations as any[]) {
        if (calc.staff_id === target.id) {
          calc.staff_name_snapshot = target.name;
          calc.staff_email_snapshot = target.email;
        }
      }

      store.app_users = store.app_users.filter(u => u.id !== target.id);
      return { user: snapshot, unassignedPatients };
    });

    await writeAudit(session.id, 'DELETE_USER', 'app_user', id, deleted);
    return NextResponse.json({ ok: true, ...deleted });
  } catch (error: any) {
    const status = error.message === 'UNAUTHENTICATED' ? 401 : error.message === 'FORBIDDEN' ? 403 : error.message === 'User not found' ? 404 : 400;
    return NextResponse.json({ error: error.message || 'Failed to delete user' }, { status });
  }
}
