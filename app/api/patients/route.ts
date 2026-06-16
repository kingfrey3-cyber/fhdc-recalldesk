import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { readStore, publicUser } from '@/lib/localDb';

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const search = (url.searchParams.get('search') || '').trim().toLowerCase();
    const status = url.searchParams.get('status') || '';
    const staffId = (url.searchParams.get('staffId') || '').trim();
    const mine = url.searchParams.get('mine') === '1';
    const limit = Math.min(Number(url.searchParams.get('limit') || 250), 1000);

    const store = await readStore();
    const usersById = new Map(store.app_users.map(u => [u.id, publicUser(u)]));

    let rows = [...store.patient_master];

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

    rows.sort((a: any, b: any) => String(a.last_visit_date || '9999').localeCompare(String(b.last_visit_date || '9999')));
    const patients = rows.slice(0, limit).map((p: any) => ({
      ...p,
      assigned_user: p.assigned_to ? usersById.get(p.assigned_to) || null : null,
      call_count: store.call_attempts.filter((c: any) => c.patient_id === p.id).length
    }));

    return NextResponse.json({ patients, me: user, totalMatched: rows.length });
  } catch (error: any) {
    const status = error.message === 'UNAUTHENTICATED' ? 401 : error.message === 'FORBIDDEN' ? 403 : 500;
    return NextResponse.json({ error: error.message || 'Failed to load patients' }, { status });
  }
}
