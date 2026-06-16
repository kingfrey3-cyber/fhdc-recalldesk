import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { updateStore, nowIso } from '@/lib/localDb';
import { writeAudit } from '@/lib/audit';

export async function POST(req: Request) {
  try {
    const user = await requireUser(['admin', 'manager']);
    const body = await req.json();
    const patientIds: string[] = Array.isArray(body.patientIds) ? body.patientIds.filter(Boolean) : [];
    const staffId = String(body.staffId || '').trim();

    if (!patientIds.length && !staffId) {
      return NextResponse.json({ error: 'Select a patient or staff member to unassign.' }, { status: 400 });
    }

    const result = await updateStore(store => {
      const calledPatientIds = new Set(store.call_attempts.map((c: any) => c.patient_id));
      const bookedPatientIds = new Set(store.bookings.map((b: any) => b.patient_id));
      const idSet = new Set(patientIds);

      const targets = store.patient_master.filter((p: any) => {
        if (patientIds.length) return idSet.has(p.id);
        return p.assigned_to === staffId;
      });

      let unassigned = 0;
      let skippedWorked = 0;
      let skippedAlreadyUnassigned = 0;

      targets.forEach((p: any) => {
        if (!p.assigned_to) {
          skippedAlreadyUnassigned += 1;
          return;
        }

        const hasWorkHistory = calledPatientIds.has(p.id) || bookedPatientIds.has(p.id) || !['assigned', 'unassigned'].includes(p.assignment_status);
        if (hasWorkHistory) {
          skippedWorked += 1;
          return;
        }

        p.assigned_to = null;
        p.assignment_status = 'unassigned';
        p.updated_at = nowIso();
        unassigned += 1;
      });

      return {
        requested: targets.length,
        unassigned,
        skippedWorked,
        skippedAlreadyUnassigned
      };
    });

    await writeAudit(user.id, 'UNASSIGN_PATIENTS', 'patient_master', staffId || 'selected_patients', result);
    return NextResponse.json(result);
  } catch (error: any) {
    const status = error.message === 'UNAUTHENTICATED' ? 401 : error.message === 'FORBIDDEN' ? 403 : 500;
    return NextResponse.json({ error: error.message || 'Unassignment failed' }, { status });
  }
}
