import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { readStore, publicUser, clearStoreCache } from '@/lib/localDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const search = (url.searchParams.get('search') || '').trim().toLowerCase();
    const status = url.searchParams.get('status') || '';
    const staffId = (url.searchParams.get('staffId') || '').trim();
    const mine = url.searchParams.get('mine') === '1';
    const limit = Math.min(Number(url.searchParams.get('limit') || 250), 1000);
    const fresh = url.searchParams.get('fresh') === '1';
    if (fresh) clearStoreCache();

    const store = await readStore({ fresh });
    const usersById = new Map(store.app_users.map(u => [u.id, publicUser(u)]));

    const callCountByPatient = new Map<string, number>();
    for (const c of store.call_attempts || []) {
      const patientId = String(c.patient_id || '');
      if (!patientId) continue;
      callCountByPatient.set(patientId, (callCountByPatient.get(patientId) || 0) + 1);
    }

    let rows = store.patient_master || [];

    // Hard isolation: recall staff can only ever see patients assigned to their own user id.
    if (user.role === 'recall_staff') {
      rows = rows.filter((p: any) => p.assigned_to === user.id);
    } else {
      if (mine) rows = rows.filter((p: any) => p.assigned_to === user.id);
      if (staffId) rows = rows.filter((p: any) => p.assigned_to === staffId);
    }

    if (status) rows = rows.filter((p: any) => String(p.assignment_status || '') === status);
    if (search) {
      rows = rows.filter((p: any) =>
        String(p.display_name || '').toLowerCase().includes(search) ||
        String(p.standard_phone || '').toLowerCase().includes(search) ||
        String(p.original_phones || '').toLowerCase().includes(search)
      );
    }

    const sorted = [...rows].sort((a: any, b: any) => String(a.last_visit_date || '9999').localeCompare(String(b.last_visit_date || '9999')));
    const patients = sorted.slice(0, limit).map((p: any) => ({
      ...p,
      assigned_user: p.assigned_to ? usersById.get(p.assigned_to) || null : null,
      call_count: callCountByPatient.get(p.id) || 0
    }));

    return NextResponse.json({ patients, me: user, totalMatched: sorted.length });
  } catch (error: any) {
    const status = error.message === 'UNAUTHENTICATED' ? 401 : error.message === 'FORBIDDEN' ? 403 : 500;
    return NextResponse.json({ error: error.message || 'Failed to load patients' }, { status });
  }
}
