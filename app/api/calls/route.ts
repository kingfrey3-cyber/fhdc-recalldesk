import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { readStore, updateStore, newId, nowIso, publicUser } from '@/lib/localDb';
import { writeAudit } from '@/lib/audit';

const reachedOutcomes = new Set(['Booked appointment','Interested but not booked','Call back later','Patient declined','Already visited recently']);

type StoreAny = any;

type CallBody = {
  patientId?: string;
  outcome?: string;
  appointmentDate?: string;
  patientFeedback?: string;
  notes?: string;
  nextAction?: string;
  nextActionDate?: string;
  bookingMade?: boolean;
};

function isBookingOutcome(outcome: string | undefined, bookingMade?: boolean) {
  return outcome === 'Booked appointment' || bookingMade === true;
}

function latestCallForPatient(store: StoreAny, patientId: string) {
  return [...store.call_attempts]
    .filter((c: any) => c.patient_id === patientId)
    .sort((a: any, b: any) => String(b.attempt_at || b.created_at || '').localeCompare(String(a.attempt_at || a.created_at || '')))[0] || null;
}

function recomputePatientStatus(store: StoreAny, patientId: string) {
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

function assertCanWorkPatient(user: any, patient: any) {
  if (user.role === 'recall_staff') {
    if (!patient.assigned_to) throw new Error('This patient has not been assigned to you. Ask admin to assign the patient before logging a call.');
    if (patient.assigned_to !== user.id) throw new Error('This patient is assigned to another user. You cannot view or log this patient.');
  }
}

export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const patientId = (url.searchParams.get('patientId') || '').trim();
    const staffId = (url.searchParams.get('staffId') || '').trim();
    const limit = Math.min(Number(url.searchParams.get('limit') || 100), 500);

    const store = await readStore();
    const usersById = new Map(store.app_users.map((u: any) => [u.id, publicUser(u)]));
    const patientsById = new Map(store.patient_master.map((p: any) => [p.id, p]));

    let rows = [...store.call_attempts];
    if (patientId) rows = rows.filter((c: any) => c.patient_id === patientId);

    if (user.role === 'recall_staff') {
      const allowedPatientIds = new Set(store.patient_master.filter((p: any) => p.assigned_to === user.id).map((p: any) => p.id));
      rows = rows.filter((c: any) => c.staff_id === user.id && allowedPatientIds.has(c.patient_id));
    } else if (staffId) {
      rows = rows.filter((c: any) => c.staff_id === staffId);
    }

    rows.sort((a: any, b: any) => String(b.attempt_at || b.created_at || '').localeCompare(String(a.attempt_at || a.created_at || '')));

    const calls = rows.slice(0, limit).map((c: any) => ({
      ...c,
      staff: usersById.get(c.staff_id) || null,
      patient: patientsById.get(c.patient_id) || null,
      booking: store.bookings.find((b: any) => b.call_attempt_id === c.id) || null
    }));

    return NextResponse.json({ calls });
  } catch (error: any) {
    const status = error.message === 'UNAUTHENTICATED' ? 401 : error.message === 'FORBIDDEN' ? 403 : 500;
    return NextResponse.json({ error: error.message || 'Failed to load calls' }, { status });
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(['admin','manager','recall_staff']);
    const body: CallBody = await req.json();
    if (!body.patientId || !body.outcome) return NextResponse.json({ error: 'Patient and outcome are required' }, { status: 400 });

    const bookingMade = isBookingOutcome(body.outcome, body.bookingMade);
    if (bookingMade && !body.appointmentDate) {
      return NextResponse.json({ error: 'Appointment date is required when booking is made' }, { status: 400 });
    }

    const call = await updateStore(store => {
      const patient = store.patient_master.find((p: any) => p.id === body.patientId);
      if (!patient) throw new Error('Patient not found');
      assertCanWorkPatient(user, patient);

      const attemptsSoFar = store.call_attempts.filter((c: any) => c.patient_id === body.patientId).length;
      const row = {
        id: newId('call_'),
        patient_id: body.patientId,
        staff_id: user.id,
        attempt_no: attemptsSoFar + 1,
        outcome: body.outcome,
        reached: reachedOutcomes.has(body.outcome),
        booking_made: bookingMade,
        appointment_date: body.appointmentDate || null,
        patient_feedback: body.patientFeedback || '',
        notes: body.notes || '',
        next_action: body.nextAction || '',
        next_action_date: body.nextActionDate || null,
        attempt_at: nowIso(),
        created_at: nowIso(),
        updated_at: nowIso()
      };
      store.call_attempts.push(row);

      if (bookingMade) {
        store.bookings.push({
          id: newId('booking_'),
          patient_id: body.patientId,
          staff_id: user.id,
          call_attempt_id: row.id,
          appointment_date: body.appointmentDate,
          booking_status: 'self_reported',
          attendance_status: 'not_matured',
          created_at: nowIso(),
          updated_at: nowIso()
        });
      }

      if (body.outcome === 'Do not call') patient.do_not_call = true;
      recomputePatientStatus(store, body.patientId!);

      if (body.outcome === 'Wrong number' || body.outcome === 'Number not in service') {
        store.data_quality_flags.push({
          id: newId('flag_'),
          batch_id: null,
          patient_id: body.patientId,
          staff_id: user.id,
          call_attempt_id: row.id,
          flag_type: 'bad_phone_number',
          severity: 'high',
          status: 'open',
          description: `Call outcome marked as ${body.outcome}. Phone requires review before further recall.`,
          created_at: nowIso()
        });
      }
      return row;
    });

    await writeAudit(user.id, 'LOG_CALL_ATTEMPT', 'call_attempt', call.id, { patientId: body.patientId, outcome: body.outcome });
    return NextResponse.json({ call });
  } catch (error: any) {
    const status = error.message === 'UNAUTHENTICATED' ? 401 : error.message === 'FORBIDDEN' ? 403 : 500;
    return NextResponse.json({ error: error.message || 'Failed to save call' }, { status });
  }
}
