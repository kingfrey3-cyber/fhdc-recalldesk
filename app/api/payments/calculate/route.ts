import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { calculateStaffPay, AssumptionMap } from '@/lib/paymentLogic';
import { updateStore, newId, nowIso, publicUser } from '@/lib/localDb';
import { writeAudit } from '@/lib/audit';

function inDateWindow(value: string | null | undefined, startDate: string, endDate: string) {
  if (!value) return false;
  const d = String(value).slice(0, 10);
  return d >= startDate && d <= endDate;
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(['admin','manager','finance']);
    const body = await req.json();
    const { periodName, startDate, endDate, workDays, teamTargetAchieved } = body;
    if (!periodName || !startDate || !endDate) return NextResponse.json({ error: 'Period name, start date and end date are required' }, { status: 400 });

    const result = await updateStore(store => {
      const period = {
        id: newId('period_'),
        period_name: periodName,
        start_date: startDate,
        end_date: endDate,
        work_days: Number(workDays || 0),
        team_target_achieved: !!teamTargetAchieved,
        status: 'calculated',
        created_by: user.id,
        created_at: nowIso()
      };
      store.payment_periods.push(period);

      const assumptions: AssumptionMap = {};
      (store.payment_assumptions || []).forEach((r: any) => { assumptions[r.key] = Number(r.value); });

      const staff = store.app_users
        .filter((u: any) => u.is_active && ['recall_staff','manager'].includes(u.role))
        .map(publicUser);

      const results: any[] = [];
      for (const s of staff) {
        const calls = store.call_attempts.filter((c: any) => c.staff_id === s.id && inDateWindow(c.attempt_at || c.created_at, startDate, endDate));
        const uniquePatientsCalled = new Set(calls.map((c: any) => c.patient_id)).size;

        const bookings = store.bookings.filter((b: any) => b.staff_id === s.id && inDateWindow(b.created_at, startDate, endDate));
        const verifiedBookings = bookings.filter((b: any) => b.booking_status === 'verified').length;
        const maturedBookings = bookings.filter((b: any) => String(b.appointment_date || '').slice(0, 10) <= endDate).length;
        const attendedPatients = bookings.filter((b: any) => b.attendance_status === 'attended').length;

        const flags = store.data_quality_flags.filter((f: any) => f.staff_id === s.id && (f.status || 'open') === 'open' && inDateWindow(f.created_at, startDate, endDate));
        const criticalIssue = flags.some((f: any) => f.severity === 'critical');
        const highIssues = flags.filter((f: any) => f.severity === 'high' || f.severity === 'critical').length;
        const dataQualityMet = highIssues === 0;

        const calc = calculateStaffPay({
          workDays: Number(workDays),
          teamTargetAchieved: !!teamTargetAchieved,
          uniquePatientsCalled,
          verifiedBookings,
          maturedBookings,
          attendedPatients,
          dataQualityMet,
          criticalIssue,
          assumptions
        });

        const stats = { staff: s, uniquePatientsCalled, verifiedBookings, maturedBookings, attendedPatients, dataQualityMet, criticalIssue, ...calc };
        const approvalStatus = calc.flags.length ? 'review_required' : 'pending';
        const row = {
          id: newId('paycalc_'),
          period_id: period.id,
          staff_id: s.id,
          stats,
          base_pay: calc.basePay,
          gross_incentive: calc.grossIncentive,
          incentive_after_cap: calc.incentiveAfterCap,
          total_pay: calc.totalPay,
          payment_flags: calc.flags,
          approval_status: approvalStatus,
          created_at: nowIso()
        };
        store.staff_payment_calculations.push(row);
        results.push(row);
      }
      return { period, results };
    });

    await writeAudit(user.id, 'CALCULATE_PAYMENTS', 'payment_period', result.period.id, { periodName, startDate, endDate, staffCount: result.results.length });
    return NextResponse.json(result);
  } catch (error: any) {
    const status = error.message === 'UNAUTHENTICATED' ? 401 : error.message === 'FORBIDDEN' ? 403 : 500;
    return NextResponse.json({ error: error.message || 'Failed to calculate payments' }, { status });
  }
}
