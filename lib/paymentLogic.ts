export type AssumptionMap = Record<string, number>;

export function n(value: any, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getConversionBonus(conversionRate: number, a: AssumptionMap) {
  if (conversionRate >= 0.125) return n(a.conversion_bonus_12_5_percent);
  if (conversionRate >= 0.10) return n(a.conversion_bonus_10_percent);
  if (conversionRate >= 0.08) return n(a.conversion_bonus_8_percent);
  if (conversionRate >= 0.05) return n(a.conversion_bonus_5_percent);
  return 0;
}

export function getShowUpMultiplier(showUpRate: number, a: AssumptionMap) {
  if (showUpRate >= 0.60) return n(a.show_up_multiplier_60_percent, 1);
  if (showUpRate >= 0.50) return n(a.show_up_multiplier_50_percent, 0.75);
  if (showUpRate >= 0.40) return n(a.show_up_multiplier_40_percent, 0.5);
  return 0;
}

export function calculateStaffPay(input: {
  workDays: number;
  teamTargetAchieved: boolean;
  uniquePatientsCalled: number;
  verifiedBookings: number;
  maturedBookings: number;
  attendedPatients: number;
  dataQualityMet: boolean;
  criticalIssue: boolean;
  assumptions: AssumptionMap;
}) {
  const a = input.assumptions;
  const monthlyTarget = input.workDays * n(a.daily_call_target);
  const conversionRate = input.uniquePatientsCalled ? input.verifiedBookings / input.uniquePatientsCalled : 0;
  const showUpRate = input.maturedBookings ? input.attendedPatients / input.maturedBookings : 0;

  const bookingBonusRaw = input.verifiedBookings * n(a.booking_bonus_per_verified_booking);
  const showUpMultiplier = getShowUpMultiplier(showUpRate, a);
  const adjustedBookingBonus = bookingBonusRaw * showUpMultiplier;
  const attendanceBonus = input.attendedPatients * n(a.attendance_bonus_per_attended_patient);
  const dataQualityBonus = input.dataQualityMet ? n(a.data_quality_bonus) : 0;
  const teamBonus = input.teamTargetAchieved ? n(a.team_target_bonus) : 0;
  const conversionBonus = getConversionBonus(conversionRate, a);

  const grossIncentive = input.criticalIssue
    ? 0
    : dataQualityBonus + adjustedBookingBonus + attendanceBonus + conversionBonus + teamBonus;

  const incentiveAfterCap = Math.min(grossIncentive, n(a.monthly_incentive_cap));
  const basePay = n(a.base_pay);
  const totalPay = basePay + incentiveAfterCap;

  const flags: string[] = [];
  if (input.uniquePatientsCalled < monthlyTarget) flags.push('Below monthly call target');
  if (conversionRate < n(a.minimum_conversion_target)) flags.push('Below booking conversion target');
  if (showUpRate > 0 && showUpRate < 0.8) flags.push('Show up rate below good quality threshold');
  if (!input.dataQualityMet) flags.push('Data quality bonus not met');
  if (input.criticalIssue) flags.push('Critical data or conduct issue: incentive set to zero');
  if (grossIncentive > incentiveAfterCap) flags.push('Incentive capped');

  return {
    monthlyTarget,
    conversionRate,
    showUpRate,
    bookingBonusRaw,
    showUpMultiplier,
    adjustedBookingBonus,
    attendanceBonus,
    dataQualityBonus,
    teamBonus,
    conversionBonus,
    grossIncentive,
    incentiveAfterCap,
    basePay,
    totalPay,
    flags
  };
}
