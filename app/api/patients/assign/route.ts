import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { updateStore, nowIso } from '@/lib/localDb';
import { writeAudit } from '@/lib/audit';

export async function POST(req: Request) {
  try {
    const user = await requireUser(['admin','manager']);
    const body = await req.json();
    const staffId = body.staffId;
    const patientIds: string[] = body.patientIds || [];
    const count = Number(body.count || 0);

    if (!staffId) return NextResponse.json({ error: 'Select staff member' }, { status: 400 });

    const assigned = await updateStore(store => {
      let ids = patientIds;
      if (!ids.length && count > 0) {
        ids = store.patient_master
          .filter((p: any) => p.assignment_status === 'unassigned' && !p.do_not_call)
          .sort((a: any, b: any) => String(a.last_visit_date || '9999').localeCompare(String(b.last_visit_date || '9999')))
          .slice(0, count)
          .map((p: any) => p.id);
      }
      if (!ids.length) return 0;
      const idSet = new Set(ids);
      let n = 0;
      store.patient_master.forEach((p: any) => {
        if (idSet.has(p.id)) {
          p.assigned_to = staffId;
          p.assignment_status = 'assigned';
          p.updated_at = nowIso();
          n += 1;
        }
      });
      return n;
    });

    if (!assigned) return NextResponse.json({ error: 'No patients selected or available for assignment' }, { status: 400 });
    await writeAudit(user.id, 'ASSIGN_PATIENTS', 'patient_master', staffId, { staffId, count: assigned });
    return NextResponse.json({ assigned });
  } catch (error: any) {
    const status = error.message === 'UNAUTHENTICATED' ? 401 : error.message === 'FORBIDDEN' ? 403 : 500;
    return NextResponse.json({ error: error.message || 'Assignment failed' }, { status });
  }
}
