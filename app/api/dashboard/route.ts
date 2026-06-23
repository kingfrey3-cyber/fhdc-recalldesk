import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { readStoreFresh } from '@/lib/localDb';
import { useTableStorage, getDashboard } from '@/lib/tableDb';

export async function GET() {
  try {
    const user = await requireUser();
    if (useTableStorage()) {
      const data = await getDashboard(user);
      return NextResponse.json({ me: user, ...data });
    }
    const store = await readStoreFresh();
    const staffScope = user.role === 'recall_staff' ? user.id : null;
    const patients = staffScope ? store.patient_master.filter((p: any) => p.assigned_to === staffScope) : store.patient_master;
    const patientIds = new Set(patients.map((p: any) => p.id));
    const calls = staffScope ? store.call_attempts.filter((c: any) => c.staff_id === staffScope && patientIds.has(c.patient_id)) : store.call_attempts;
    const bookings = staffScope ? store.bookings.filter((b: any) => b.staff_id === staffScope && patientIds.has(b.patient_id)) : store.bookings;
    const flags = staffScope ? store.data_quality_flags.filter((f: any) => f.staff_id === staffScope || patientIds.has(f.patient_id)) : store.data_quality_flags;
    const activeFlags = flags.filter((f: any) => (f.status || 'open') === 'open');
    return NextResponse.json({ me: user, metrics: { patients: patients.length, unassigned: staffScope ? 0 : patients.filter((p: any) => p.assignment_status === 'unassigned').length, assigned: patients.filter((p: any) => p.assigned_to).length, uniqueCalled: new Set(calls.map((c: any) => c.patient_id)).size, verifiedBookings: bookings.filter((b: any) => b.booking_status === 'verified').length, selfReportedBookings: bookings.filter((b: any) => b.booking_status === 'self_reported').length, attended: bookings.filter((b: any) => b.attendance_status === 'attended').length, openFlags: activeFlags.length }, flags: activeFlags.slice(0, 50), recentUploads: staffScope ? [] : [...store.upload_batches].sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 5) });
  } catch (error: any) {
    const status = error.message === 'UNAUTHENTICATED' ? 401 : error.message === 'FORBIDDEN' ? 403 : 500;
    return NextResponse.json({ error: error.message || 'Failed to load dashboard' }, { status });
  }
}
