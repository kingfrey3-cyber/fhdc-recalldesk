import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { updateStoreFresh, nowIso, newId } from '@/lib/localDb';
import { writeAudit } from '@/lib/audit';
import { useTableStorage, updateCall as updateTableCall, deleteCall as deleteTableCall } from '@/lib/tableDb';

type RouteContext = { params: Promise<{ id: string }> | { id: string } };
async function getParams(context: RouteContext) { return await context.params; }
const reachedOutcomes = new Set(['Booked appointment','Interested but not booked','Call back later','Patient declined','Already visited recently']);
function isBookingOutcome(outcome: string | undefined, bookingMade?: boolean) { return outcome === 'Booked appointment' || bookingMade === true; }
function recomputePatientStatus(store: any, patientId: string) { const patient = store.patient_master.find((p: any) => p.id === patientId); if (!patient) return; const latest = [...store.call_attempts].filter((c: any) => c.patient_id === patientId).sort((a: any, b: any) => String(b.attempt_at || b.created_at || '').localeCompare(String(a.attempt_at || a.created_at || '')))[0]; if (!latest) patient.assignment_status = patient.assigned_to ? 'assigned' : 'unassigned'; else if (latest.booking_made) patient.assignment_status = 'booked'; else if (latest.next_action_date || latest.next_action) patient.assignment_status = 'follow_up'; else patient.assignment_status = 'called'; patient.updated_at = nowIso(); }
function canModifyCall(user: any, call: any, patient: any, booking: any) { if (['admin','manager'].includes(user.role)) return true; if (user.role !== 'recall_staff') return false; if (call.staff_id !== user.id) return false; if (!patient || patient.assigned_to !== user.id) return false; if (booking && (booking.booking_status === 'verified' || booking.attendance_status === 'attended')) return false; return true; }

export async function PUT(req: Request, context: RouteContext) {
  try {
    const user = await requireUser(['admin','manager','recall_staff']);
    const { id } = await getParams(context);
    const body = await req.json();
    if (!body.outcome) return NextResponse.json({ error: 'Outcome is required' }, { status: 400 });
    if (useTableStorage()) { const call = await updateTableCall(user, id, body); await writeAudit(user.id, 'EDIT_CALL_ATTEMPT', 'call_attempt', id, { outcome: body.outcome }); return NextResponse.json({ call }); }
    const bookingMade = isBookingOutcome(body.outcome, body.bookingMade);
    const updated = await updateStoreFresh(store => { const call = store.call_attempts.find((c: any) => c.id === id); if (!call) throw new Error('Call log not found'); const patient = store.patient_master.find((p: any) => p.id === call.patient_id); const booking = store.bookings.find((b: any) => b.call_attempt_id === call.id); if (!canModifyCall(user, call, patient, booking)) throw new Error('FORBIDDEN'); Object.assign(call, { outcome: body.outcome, reached: reachedOutcomes.has(body.outcome), booking_made: bookingMade, appointment_date: body.appointmentDate || null, patient_feedback: body.patientFeedback || '', notes: body.notes || '', next_action: body.nextAction || '', next_action_date: body.nextActionDate || null, updated_at: nowIso(), edited_by: user.id }); store.bookings = store.bookings.filter((b: any) => b.call_attempt_id !== call.id); if (bookingMade) store.bookings.push({ id: newId('booking_'), patient_id: call.patient_id, staff_id: call.staff_id, call_attempt_id: call.id, appointment_date: body.appointmentDate, booking_status: 'self_reported', attendance_status: 'not_matured', created_at: nowIso(), updated_at: nowIso() }); recomputePatientStatus(store, call.patient_id); return call; });
    await writeAudit(user.id, 'EDIT_CALL_ATTEMPT', 'call_attempt', id, { outcome: body.outcome }); return NextResponse.json({ call: updated });
  } catch (error: any) { const status = error.message === 'UNAUTHENTICATED' ? 401 : error.message === 'FORBIDDEN' ? 403 : error.message === 'Call log not found' ? 404 : 400; return NextResponse.json({ error: error.message || 'Failed to update call log' }, { status }); }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const user = await requireUser(['admin','manager','recall_staff']);
    const { id } = await getParams(context);
    const result = useTableStorage() ? await deleteTableCall(user, id) : await updateStoreFresh(store => { const call = store.call_attempts.find((c: any) => c.id === id); if (!call) throw new Error('Call log not found'); const patient = store.patient_master.find((p: any) => p.id === call.patient_id); const booking = store.bookings.find((b: any) => b.call_attempt_id === call.id); if (!canModifyCall(user, call, patient, booking)) throw new Error('FORBIDDEN'); store.call_attempts = store.call_attempts.filter((c: any) => c.id !== id); store.bookings = store.bookings.filter((b: any) => b.call_attempt_id !== id); recomputePatientStatus(store, call.patient_id); return { patientId: call.patient_id }; });
    await writeAudit(user.id, 'UNLOG_CALL_ATTEMPT', 'call_attempt', id, result); return NextResponse.json({ ok: true, ...result });
  } catch (error: any) { const status = error.message === 'UNAUTHENTICATED' ? 401 : error.message === 'FORBIDDEN' ? 403 : error.message === 'Call log not found' ? 404 : 400; return NextResponse.json({ error: error.message || 'Failed to unlog call' }, { status }); }
}
