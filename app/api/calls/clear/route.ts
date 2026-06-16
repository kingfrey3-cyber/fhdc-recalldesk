import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { updateStore, nowIso } from '@/lib/localDb';
import { writeAudit } from '@/lib/audit';

function latestCallForPatient(store: any, patientId: string) {
  return [...store.call_attempts]
    .filter((c: any) => c.patient_id === patientId)
    .sort((a: any, b: any) => String(b.attempt_at || b.created_at || '').localeCompare(String(a.attempt_at || a.created_at || '')))[0] || null;
}

function recomputePatientStatus(store: any, patientId: string) {
  const patient = store.patient_master.find((p: any) => p.id === patientId);
  if (!patient) return;
  const latest = latestCallForPatient(store, patientId);
  if (!latest) {
    patient.assignment_status = patient.assigned_to ? 'assigned' : 'unassigned';
    patient.updated_at = nowIso();
    return;
  }
  if (latest.booking_made) patient.assignment_status = 'booked';
  else if (latest.next_action_date || latest.next_action) patient.assignment_status = 'follow_up';
  else patient.assignment_status = 'called';
  patient.updated_at = nowIso();
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(['admin','manager']);
    const body = await req.json();
    const staffId = String(body.staffId || '').trim();
    const confirmText = String(body.confirmText || '').trim().toUpperCase();

    if (!staffId) return NextResponse.json({ error: 'Select a staff member whose call logs should be cleared.' }, { status: 400 });
    if (confirmText !== 'CLEAR') return NextResponse.json({ error: 'Type CLEAR to confirm call log cleanup.' }, { status: 400 });

    const result = await updateStore(store => {
      const staff = store.app_users.find((u: any) => u.id === staffId);
      if (!staff) throw new Error('Staff user not found');

      const callsToRemove = store.call_attempts.filter((c: any) => c.staff_id === staffId);
      const callIds = new Set(callsToRemove.map((c: any) => c.id));
      const affectedPatientIds = new Set(callsToRemove.map((c: any) => c.patient_id));

      const bookingCount = store.bookings.filter((b: any) => b.staff_id === staffId || callIds.has(b.call_attempt_id)).length;
      store.call_attempts = store.call_attempts.filter((c: any) => c.staff_id !== staffId);
      store.bookings = store.bookings.filter((b: any) => b.staff_id !== staffId && !callIds.has(b.call_attempt_id));

      let closedFlags = 0;
      store.data_quality_flags.forEach((f: any) => {
        const related = f.staff_id === staffId || (f.call_attempt_id && callIds.has(f.call_attempt_id));
        if (related && (f.status || 'open') === 'open' && ['bad_phone_number', 'call_quality_issue'].includes(f.flag_type)) {
          f.status = 'closed';
          f.closed_at = nowIso();
          f.closed_by = user.id;
          f.closure_note = 'Closed during admin test/training call cleanup.';
          closedFlags += 1;
        }
      });

      affectedPatientIds.forEach((patientId: string) => recomputePatientStatus(store, patientId));

      return {
        staff: { id: staff.id, name: staff.name, email: staff.email },
        removedCalls: callsToRemove.length,
        removedBookings: bookingCount,
        affectedPatients: affectedPatientIds.size,
        closedFlags
      };
    });

    await writeAudit(user.id, 'CLEAR_STAFF_CALL_LOGS', 'call_attempt', staffId, result);
    return NextResponse.json(result);
  } catch (error: any) {
    const status = error.message === 'UNAUTHENTICATED' ? 401 : error.message === 'FORBIDDEN' ? 403 : error.message === 'Staff user not found' ? 404 : 500;
    return NextResponse.json({ error: error.message || 'Failed to clear staff call logs' }, { status });
  }
}
