import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { updateStore, nowIso, newId } from '@/lib/localDb';
import { writeAudit } from '@/lib/audit';

const reachedOutcomes = new Set(['Booked appointment','Interested but not booked','Call back later','Patient declined','Already visited recently']);

function isBookingOutcome(outcome: string | undefined, bookingMade?: boolean) {
  return outcome === 'Booked appointment' || bookingMade === true;
}

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

  if (latest.outcome === 'Do not call') {
    patient.assignment_status = 'do_not_call';
    patient.do_not_call = true;
  } else if (latest.booking_made) {
    patient.assignment_status = 'booked';
  } else if (latest.next_action_date || latest.next_action) {
    patient.assignment_status = 'follow_up';
  } else {
    patient.assignment_status = 'called';
  }
  patient.updated_at = nowIso();
}

function canModifyCall(user: any, call: any, patient: any, booking: any) {
  if (['admin', 'manager'].includes(user.role)) return true;
  if (user.role !== 'recall_staff') return false;
  if (call.staff_id !== user.id) return false;
  if (!patient || patient.assigned_to !== user.id) return false;
  if (booking && (booking.booking_status === 'verified' || booking.attendance_status === 'attended')) return false;
  return true;
}

export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(['admin','manager','recall_staff']);
    const { id } = await context.params;
    const body = await req.json();
    if (!body.outcome) return NextResponse.json({ error: 'Outcome is required' }, { status: 400 });

    const bookingMade = isBookingOutcome(body.outcome, body.bookingMade);
    if (bookingMade && !body.appointmentDate) {
      return NextResponse.json({ error: 'Appointment date is required when booking is made' }, { status: 400 });
    }

    const updated = await updateStore(store => {
      const call = store.call_attempts.find((c: any) => c.id === id);
      if (!call) throw new Error('Call log not found');
      const patient = store.patient_master.find((p: any) => p.id === call.patient_id);
      const booking = store.bookings.find((b: any) => b.call_attempt_id === call.id);
      if (!canModifyCall(user, call, patient, booking)) throw new Error('FORBIDDEN');

      call.outcome = body.outcome;
      call.reached = reachedOutcomes.has(body.outcome);
      call.booking_made = bookingMade;
      call.appointment_date = body.appointmentDate || null;
      call.patient_feedback = body.patientFeedback || '';
      call.notes = body.notes || '';
      call.next_action = body.nextAction || '';
      call.next_action_date = body.nextActionDate || null;
      call.updated_at = nowIso();
      call.edited_by = user.id;

      if (bookingMade) {
        if (booking) {
          booking.appointment_date = body.appointmentDate;
          booking.updated_at = nowIso();
        } else {
          store.bookings.push({
            id: newId('booking_'),
            patient_id: call.patient_id,
            staff_id: call.staff_id,
            call_attempt_id: call.id,
            appointment_date: body.appointmentDate,
            booking_status: 'self_reported',
            attendance_status: 'not_matured',
            created_at: nowIso(),
            updated_at: nowIso()
          });
        }
      } else {
        store.bookings = store.bookings.filter((b: any) => b.call_attempt_id !== call.id);
      }

      // Close old call-generated bad-phone flags if the edited outcome no longer supports them.
      if (!(body.outcome === 'Wrong number' || body.outcome === 'Number not in service')) {
        store.data_quality_flags.forEach((f: any) => {
          if ((f.call_attempt_id === call.id || (!f.call_attempt_id && f.patient_id === call.patient_id && f.staff_id === call.staff_id)) && f.flag_type === 'bad_phone_number' && f.status === 'open') {
            f.status = 'closed';
            f.closed_at = nowIso();
            f.closed_by = user.id;
          }
        });
      }

      recomputePatientStatus(store, call.patient_id);
      return call;
    });

    await writeAudit(user.id, 'EDIT_CALL_ATTEMPT', 'call_attempt', id, { outcome: body.outcome });
    return NextResponse.json({ call: updated });
  } catch (error: any) {
    const status = error.message === 'UNAUTHENTICATED' ? 401 : error.message === 'FORBIDDEN' ? 403 : error.message === 'Call log not found' ? 404 : 500;
    return NextResponse.json({ error: error.message || 'Failed to update call log' }, { status });
  }
}

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(['admin','manager','recall_staff']);
    const { id } = await context.params;

    const result = await updateStore(store => {
      const call = store.call_attempts.find((c: any) => c.id === id);
      if (!call) throw new Error('Call log not found');
      const patient = store.patient_master.find((p: any) => p.id === call.patient_id);
      const booking = store.bookings.find((b: any) => b.call_attempt_id === call.id);
      if (!canModifyCall(user, call, patient, booking)) throw new Error('FORBIDDEN');

      store.call_attempts = store.call_attempts.filter((c: any) => c.id !== id);
      store.bookings = store.bookings.filter((b: any) => b.call_attempt_id !== id);
      store.data_quality_flags.forEach((f: any) => {
        if ((f.call_attempt_id === id || (!f.call_attempt_id && f.patient_id === call.patient_id && f.staff_id === call.staff_id)) && f.status === 'open') {
          f.status = 'closed';
          f.closed_at = nowIso();
          f.closed_by = user.id;
        }
      });
      recomputePatientStatus(store, call.patient_id);
      return { patientId: call.patient_id };
    });

    await writeAudit(user.id, 'UNLOG_CALL_ATTEMPT', 'call_attempt', id, result);
    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    const status = error.message === 'UNAUTHENTICATED' ? 401 : error.message === 'FORBIDDEN' ? 403 : error.message === 'Call log not found' ? 404 : 500;
    return NextResponse.json({ error: error.message || 'Failed to unlog call' }, { status });
  }
}
