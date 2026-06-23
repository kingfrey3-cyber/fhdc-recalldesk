import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { readStoreFresh, updateStoreFresh, newId, nowIso, publicUser } from '@/lib/localDb';
import { writeAudit } from '@/lib/audit';
import { useTableStorage, listCalls, createCall as createTableCall } from '@/lib/tableDb';

const reachedOutcomes = new Set(['Booked appointment','Interested but not booked','Call back later','Patient declined','Already visited recently']);
type CallBody = { patientId?: string; outcome?: string; appointmentDate?: string; patientFeedback?: string; notes?: string; nextAction?: string; nextActionDate?: string; bookingMade?: boolean; };
function isBookingOutcome(outcome: string | undefined, bookingMade?: boolean) { return outcome === 'Booked appointment' || bookingMade === true; }
function latestCallForPatient(store: any, patientId: string) { return [...store.call_attempts].filter((c: any) => c.patient_id === patientId).sort((a: any, b: any) => String(b.attempt_at || b.created_at || '').localeCompare(String(a.attempt_at || a.created_at || '')))[0] || null; }
export function recomputePatientStatus(store: any, patientId: string) { const patient = store.patient_master.find((p: any) => p.id === patientId); if (!patient) return; const latest = latestCallForPatient(store, patientId); if (!latest) { patient.assignment_status = patient.assigned_to ? 'assigned' : 'unassigned'; patient.updated_at = nowIso(); return; } if (latest.outcome === 'Do not call') { patient.assignment_status = 'do_not_call'; patient.do_not_call = true; } else if (latest.booking_made) patient.assignment_status = 'booked'; else if (latest.next_action_date || latest.next_action) patient.assignment_status = 'follow_up'; else patient.assignment_status = 'called'; patient.updated_at = nowIso(); }
function assertCanWorkPatient(user: any, patient: any) { if (user.role === 'recall_staff') { if (!patient.assigned_to) throw new Error('This patient has not been assigned to you. Ask admin to assign the patient before logging a call.'); if (patient.assigned_to !== user.id) throw new Error('This patient is assigned to another user. You cannot view or log this patient.'); } }

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const patientId = (url.searchParams.get('patientId') || '').trim();
    const staffId = (url.searchParams.get('staffId') || '').trim();
    const limit = Math.min(Number(url.searchParams.get('limit') || 100), 500);
    if (useTableStorage()) return NextResponse.json({ calls: await listCalls(user, { patientId, staffId, limit }) });
    const store = await readStoreFresh();
    const usersById = new Map(store.app_users.map((u: any) => [u.id, publicUser(u)]));
    const patientsById = new Map(store.patient_master.map((p: any) => [p.id, p]));
    let rows = [...store.call_attempts];
    if (patientId) rows = rows.filter((c: any) => c.patient_id === patientId);
    if (user.role === 'recall_staff') rows = rows.filter((c: any) => c.staff_id === user.id); else if (staffId) rows = rows.filter((c: any) => c.staff_id === staffId);
    rows.sort((a: any, b: any) => String(b.attempt_at || b.created_at || '').localeCompare(String(a.attempt_at || a.created_at || '')));
    return NextResponse.json({ calls: rows.slice(0, limit).map((c: any) => ({ ...c, staff: usersById.get(c.staff_id) || null, patient: patientsById.get(c.patient_id) || null, booking: store.bookings.find((b: any) => b.call_attempt_id === c.id) || null })) });
  } catch (error: any) { const status = error.message === 'UNAUTHENTICATED' ? 401 : error.message === 'FORBIDDEN' ? 403 : 500; return NextResponse.json({ error: error.message || 'Failed to load calls' }, { status }); }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(['admin','manager','recall_staff']);
    const body: CallBody = await req.json();
    if (useTableStorage()) { const call = await createTableCall(user, body); await writeAudit(user.id, 'LOG_CALL_ATTEMPT', 'call_attempt', call.id, { patientId: body.patientId, outcome: body.outcome }); return NextResponse.json({ call }); }
    if (!body.patientId || !body.outcome) return NextResponse.json({ error: 'Patient and outcome are required' }, { status: 400 });
    const bookingMade = isBookingOutcome(body.outcome, body.bookingMade);
    if (bookingMade && !body.appointmentDate) return NextResponse.json({ error: 'Appointment date is required when booking is made' }, { status: 400 });
    const call = await updateStoreFresh(store => {
      const patient = store.patient_master.find((p: any) => p.id === body.patientId); if (!patient) throw new Error('Patient not found'); assertCanWorkPatient(user, patient);
      const attemptsSoFar = store.call_attempts.filter((c: any) => c.patient_id === body.patientId).length;
      const row = { id: newId('call_'), patient_id: body.patientId, staff_id: user.id, attempt_no: attemptsSoFar + 1, outcome: body.outcome, reached: reachedOutcomes.has(body.outcome || ''), booking_made: bookingMade, appointment_date: body.appointmentDate || null, patient_feedback: body.patientFeedback || '', notes: body.notes || '', next_action: body.nextAction || '', next_action_date: body.nextActionDate || null, attempt_at: nowIso(), created_at: nowIso(), updated_at: nowIso() };
      store.call_attempts.push(row); if (bookingMade) store.bookings.push({ id: newId('booking_'), patient_id: body.patientId, staff_id: user.id, call_attempt_id: row.id, appointment_date: body.appointmentDate, booking_status: 'self_reported', attendance_status: 'not_matured', created_at: nowIso(), updated_at: nowIso() });
      recomputePatientStatus(store, body.patientId!); return row;
    });
    await writeAudit(user.id, 'LOG_CALL_ATTEMPT', 'call_attempt', call.id, { patientId: body.patientId, outcome: body.outcome });
    return NextResponse.json({ call });
  } catch (error: any) { const status = error.message === 'UNAUTHENTICATED' ? 401 : error.message === 'FORBIDDEN' ? 403 : 400; return NextResponse.json({ error: error.message || 'Failed to save call' }, { status }); }
}
