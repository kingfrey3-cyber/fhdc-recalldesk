import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { updateStoreFresh, nowIso } from '@/lib/localDb';
import { writeAudit } from '@/lib/audit';
import { useTableStorage, unassignPatients } from '@/lib/tableDb';

export async function POST(req: Request) {
  try {
    const user = await requireUser(['admin', 'manager']);
    const body = await req.json();
    const patientIds: string[] = Array.isArray(body.patientIds) ? body.patientIds.filter(Boolean) : [];
    const staffId = String(body.staffId || '').trim();
    const result = useTableStorage() ? await unassignPatients(patientIds, staffId) : await updateStoreFresh(store => {
      const called = new Set(store.call_attempts.map((c: any) => c.patient_id)); const booked = new Set(store.bookings.map((b: any) => b.patient_id)); const idSet = new Set(patientIds);
      const targets = store.patient_master.filter((p: any) => patientIds.length ? idSet.has(p.id) : p.assigned_to === staffId);
      let unassigned = 0, skippedWorked = 0, skippedAlreadyUnassigned = 0;
      targets.forEach((p: any) => { if (!p.assigned_to) { skippedAlreadyUnassigned++; return; } if (called.has(p.id) || booked.has(p.id) || !['assigned','unassigned'].includes(p.assignment_status)) { skippedWorked++; return; } p.assigned_to = null; p.assignment_status = 'unassigned'; p.updated_at = nowIso(); unassigned++; });
      return { requested: targets.length, unassigned, skippedWorked, skippedAlreadyUnassigned };
    });
    await writeAudit(user.id, 'UNASSIGN_PATIENTS', 'patient_master', staffId || 'selected_patients', result);
    return NextResponse.json(result);
  } catch (error: any) {
    const status = error.message === 'UNAUTHENTICATED' ? 401 : error.message === 'FORBIDDEN' ? 403 : 400;
    return NextResponse.json({ error: error.message || 'Unassignment failed' }, { status });
  }
}
