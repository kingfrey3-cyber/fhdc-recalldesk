import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { updateStoreFresh, nowIso } from '@/lib/localDb';
import { writeAudit } from '@/lib/audit';
import { useTableStorage, assignPatients, assignPatientsRoundRobin } from '@/lib/tableDb';

function assignRoundRobinInStore(store: any, staffIdsInput: string[] = [], count = 0) {
  const staffIds = Array.from(new Set((staffIdsInput || []).filter(Boolean)));
  if (staffIds.length < 2) throw new Error('Balanced round-robin needs at least two selected recall staff.');
  if (!count || count < 1) throw new Error('Enter the total number of patients to distribute.');

  const staffById = new Map((store.app_users || []).map((u: any) => [u.id, u]));
  for (const staffId of staffIds) {
    const staff: any = staffById.get(staffId);
    if (!staff || staff.is_active === false) throw new Error(`Selected staff user is not active: ${staffId}`);
  }

  const candidates = (store.patient_master || [])
    .filter((p: any) => p.assignment_status === 'unassigned' && !p.do_not_call)
    .sort((a: any, b: any) => String(a.last_visit_date || '9999-12-31').localeCompare(String(b.last_visit_date || '9999-12-31')) || String(a.display_name || '').localeCompare(String(b.display_name || '')))
    .slice(0, count);

  const byStaffMap = new Map<string, number>();
  staffIds.forEach(id => byStaffMap.set(id, 0));

  candidates.forEach((patient: any, index: number) => {
    const staffId = staffIds[index % staffIds.length];
    patient.assigned_to = staffId;
    patient.assignment_status = 'assigned';
    patient.updated_at = nowIso();
    byStaffMap.set(staffId, (byStaffMap.get(staffId) || 0) + 1);
  });

  const byStaff = staffIds.map(staffId => {
    const staff: any = staffById.get(staffId) || {};
    return { staffId, staff_name: staff.name || staff.email || staffId, assigned: byStaffMap.get(staffId) || 0 };
  });

  return { total: candidates.length, byStaff };
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(['admin','manager']);
    const body = await req.json();
    const method = body.method || body.assignmentMethod || 'sequential_block';
    const staffId = body.staffId;
    const staffIds: string[] = Array.isArray(body.staffIds) ? body.staffIds : [];
    const patientIds: string[] = body.patientIds || [];
    const count = Number(body.count || 0);

    let assigned = 0;
    let byStaff: any[] = [];

    if (method === 'balanced_round_robin') {
      if (useTableStorage()) {
        const result = await assignPatientsRoundRobin(staffIds, count);
        assigned = result.total;
        byStaff = result.byStaff;
      } else {
        const result = await updateStoreFresh(store => assignRoundRobinInStore(store, staffIds, count));
        assigned = result.total;
        byStaff = result.byStaff;
      }
    } else {
      assigned = useTableStorage() ? await assignPatients(staffId, patientIds, count) : await updateStoreFresh(store => {
        if (!staffId) throw new Error('Select staff member');
        let ids = patientIds;
        if (!ids.length && count > 0) ids = store.patient_master
          .filter((p: any) => p.assignment_status === 'unassigned' && !p.do_not_call)
          .sort((a: any, b: any) => String(a.last_visit_date || '9999-12-31').localeCompare(String(b.last_visit_date || '9999-12-31')) || String(a.display_name || '').localeCompare(String(b.display_name || '')))
          .slice(0, count)
          .map((p: any) => p.id);
        const idSet = new Set(ids); let n = 0;
        store.patient_master.forEach((p: any) => { if (idSet.has(p.id)) { p.assigned_to = staffId; p.assignment_status = 'assigned'; p.updated_at = nowIso(); n++; } });
        return n;
      });
    }

    if (!assigned) return NextResponse.json({ error: 'No patients selected or available for assignment' }, { status: 400 });
    await writeAudit(user.id, method === 'balanced_round_robin' ? 'ASSIGN_PATIENTS_ROUND_ROBIN' : 'ASSIGN_PATIENTS', 'patient_master', staffId || staffIds.join(','), { method, staffId, staffIds, count: assigned, byStaff });
    return NextResponse.json({ assigned, byStaff, method });
  } catch (error: any) {
    const status = error.message === 'UNAUTHENTICATED' ? 401 : error.message === 'FORBIDDEN' ? 403 : 400;
    return NextResponse.json({ error: error.message || 'Assignment failed' }, { status });
  }
}
