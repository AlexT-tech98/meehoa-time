/**
 * MEEHOA TIME V1 - Time & Payroll Engine
 * Scheduled / Actual / Payable separation, Exception Detection, GPS & Payroll Calculations
 */

export type ExceptionType =
  | "missing_check_in"
  | "missing_check_out"
  | "late"
  | "early_leave"
  | "outside_geofence"
  | "low_gps_accuracy"
  | "unscheduled_overtime"
  | "unscheduled_work"
  | "duplicate_attendance";

export type GpsCoordinate = {
  lat: number;
  lng: number;
  accuracy?: number;
};

export type ShiftInput = {
  scheduledStart: string;
  scheduledEnd: string;
  checkIn?: string | null;
  checkOut?: string | null;
  approvedStart?: string | null;
  approvedEnd?: string | null;
  approvedOtMinutes?: number;
  otRejected?: boolean;
  graceMinutes?: number;
  roundingMinutes?: number;
  // GPS & Geofence
  shopLocation?: GpsCoordinate | null;
  shopRadiusMeters?: number;
  checkInGps?: GpsCoordinate | null;
  checkOutGps?: GpsCoordinate | null;
  maxGpsAccuracyMeters?: number;
};

export type ShiftResult = {
  scheduledMinutes: number;
  actualMinutes: number;
  payableMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  exceptions: ExceptionType[];
  confidence: "ready" | "pending";
  effectiveStart: string | null;
  effectiveEnd: string | null;
  checkInDistanceMeters?: number | null;
  checkOutDistanceMeters?: number | null;
  checkInWithinGeofence?: boolean;
  checkOutWithinGeofence?: boolean;
};

const minutesFromIso = (iso: string) => new Date(iso).getTime() / 60000;
const durationMinutes = (from: string, to: string) => Math.max(0, Math.round(minutesFromIso(to) - minutesFromIso(from)));

/**
 * Apply rounding rule to minutes (e.g. 5m, 15m or 0)
 */
export function applyRounding(mins: number, rounding: number = 0): number {
  if (rounding <= 1) return Math.round(mins);
  return Math.round(mins / rounding) * rounding;
}

/**
 * Great-circle distance between two GPS coordinates in meters
 */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = 6371000; // meters
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(x));
}

/**
 * Evaluates a scheduled shift against check-in / check-out actuals and manager decisions
 */
export function evaluateShift(input: ShiftInput): ShiftResult {
  const grace = input.graceMinutes ?? 5;
  const rounding = input.roundingMinutes ?? 0;
  const maxAccuracy = input.maxGpsAccuracyMeters ?? 150;
  const exceptions: ExceptionType[] = [];

  const scheduledMinutes = durationMinutes(input.scheduledStart, input.scheduledEnd);

  // Missing check-in / check-out detection
  if (!input.checkIn && !input.approvedStart) {
    exceptions.push("missing_check_in");
  }
  if (!input.checkOut && !input.approvedEnd) {
    exceptions.push("missing_check_out");
  }

  // Actual minutes from raw punches
  const actualMinutes = input.checkIn && input.checkOut ? durationMinutes(input.checkIn, input.checkOut) : 0;

  // Late and Early leave calculations
  const lateMinutes = input.checkIn ? Math.max(0, Math.round(minutesFromIso(input.checkIn) - minutesFromIso(input.scheduledStart))) : 0;
  const earlyLeaveMinutes = input.checkOut ? Math.max(0, Math.round(minutesFromIso(input.scheduledEnd) - minutesFromIso(input.checkOut))) : 0;

  if (lateMinutes > grace && !input.approvedStart) {
    exceptions.push("late");
  }
  if (earlyLeaveMinutes > grace && !input.approvedEnd) {
    exceptions.push("early_leave");
  }

  // Checkout after scheduled end without approved OT is unscheduled OT
  if (input.checkOut && minutesFromIso(input.checkOut) > minutesFromIso(input.scheduledEnd)) {
    if (!input.approvedOtMinutes && !input.otRejected) {
      exceptions.push("unscheduled_overtime");
    }
  }

  // GPS Geofence checks
  let checkInDist: number | null = null;
  let checkOutDist: number | null = null;
  if (input.shopLocation) {
    const radius = input.shopRadiusMeters ?? 120;

    if (input.checkInGps) {
      if (input.checkInGps.accuracy && input.checkInGps.accuracy > maxAccuracy) {
        exceptions.push("low_gps_accuracy");
      }
      checkInDist = distanceMeters(input.shopLocation, input.checkInGps);
      if (checkInDist > radius) {
        exceptions.push("outside_geofence");
        }
    }

    if (input.checkOutGps) {
      if (input.checkOutGps.accuracy && input.checkOutGps.accuracy > maxAccuracy && !exceptions.includes("low_gps_accuracy")) {
        exceptions.push("low_gps_accuracy");
      }
      checkOutDist = distanceMeters(input.shopLocation, input.checkOutGps);
      if (checkOutDist > radius && !exceptions.includes("outside_geofence")) {
        exceptions.push("outside_geofence");
        }
    }
  }

  // Scheduled / Actual / Payable separation:
  // Approved start/end overrides take precedence (e.g. from approved explanations)
  const effectiveStart = input.approvedStart ?? input.checkIn ?? null;
  const effectiveEnd = input.approvedEnd ?? input.checkOut ?? null;

  let regularMinutes = 0;
  if (effectiveStart && effectiveEnd) {
    // Payable is capped at scheduled boundaries
    const clampedStart = Math.max(minutesFromIso(effectiveStart), minutesFromIso(input.scheduledStart));
    const clampedEnd = Math.min(minutesFromIso(effectiveEnd), minutesFromIso(input.scheduledEnd));
    regularMinutes = Math.max(0, Math.round(clampedEnd - clampedStart));
  }

  // Only approved overtime is added to payable
  const overtimeMinutes = input.approvedOtMinutes && input.approvedOtMinutes > 0 ? input.approvedOtMinutes : 0;

  // Unresolved missing check-in/out holds pay in pending status
  const unresolvedMissing = (!input.checkIn && !input.approvedStart) || (!input.checkOut && !input.approvedEnd);

  const rawPayable = unresolvedMissing ? 0 : regularMinutes + overtimeMinutes;
  const payableMinutes = applyRounding(rawPayable, rounding);

  return {
    scheduledMinutes,
    actualMinutes,
    payableMinutes,
    regularMinutes: unresolvedMissing ? 0 : regularMinutes,
    overtimeMinutes: unresolvedMissing ? 0 : overtimeMinutes,
    lateMinutes,
    earlyLeaveMinutes,
    exceptions,
    confidence: unresolvedMissing ? "pending" : "ready",
    effectiveStart,
    effectiveEnd,
    checkInDistanceMeters: checkInDist,
    checkOutDistanceMeters: checkOutDist,
    checkInWithinGeofence: checkInDist !== null ? (checkInDist <= (input.shopRadiusMeters ?? 120)) : undefined,
    checkOutWithinGeofence: checkOutDist !== null ? (checkOutDist <= (input.shopRadiusMeters ?? 120)) : undefined,
  };
}

/**
 * Detect overlapping shifts for an employee
 */
export function detectOverlappingShifts(
  shifts: Array<{ id: string; startsAt: string; endsAt: string }>
): Array<{ shiftA: string; shiftB: string }> {
  const overlaps: Array<{ shiftA: string; shiftB: string }> = [];
  for (let i = 0; i < shifts.length; i++) {
    const aStart = new Date(shifts[i].startsAt).getTime();
    const aEnd = new Date(shifts[i].endsAt).getTime();
    for (let j = i + 1; j < shifts.length; j++) {
      const bStart = new Date(shifts[j].startsAt).getTime();
      const bEnd = new Date(shifts[j].endsAt).getTime();
      // Two intervals [aStart, aEnd] and [bStart, bEnd] overlap if max(start) < min(end)
      if (Math.max(aStart, bStart) < Math.min(aEnd, bEnd)) {
        overlaps.push({ shiftA: shifts[i].id, shiftB: shifts[j].id });
      }
    }
  }
  return overlaps;
}

/**
 * Prevents duplicate punches within a short cooldown threshold (idempotency / rapid clicks)
 */
export function isDuplicatePunch(
  existingPunches: Array<{ event: "check_in" | "check_out"; occurredAt: string }>,
  newPunch: { event: "check_in" | "check_out"; occurredAt: string },
  cooldownSeconds: number = 60
): boolean {
  const newTime = new Date(newPunch.occurredAt).getTime();
  return existingPunches.some((p) => {
    if (p.event !== newPunch.event) return false;
    const diffSeconds = Math.abs(newTime - new Date(p.occurredAt).getTime()) / 1000;
    return diffSeconds < cooldownSeconds;
  });
}

/**
 * Wage rate segment definition for mid-period salary changes
 */
export type WageRateSegment = {
  effectiveDate: string; // YYYY-MM-DD
  hourlyRate?: number;
  monthlySalary?: number;
};

/**
 * Calculates hourly or monthly payroll with adjustments, prorations and wage changes
 */
export function calculatePayroll(args: {
  payrollType: "hourly" | "monthly";
  payableMinutes: number;
  hourlyRate?: number;
  monthlySalary?: number;
  standardMonthlyDays?: number; // e.g. 26 days
  standardDailyHours?: number; // e.g. 8 hours (208 hours total)
  actualWorkedDays?: number;
  overtimeMinutes?: number;
  otMultiplier?: number; // e.g. 1.5
  adjustments?: Array<{ amount: number; category?: string }>;
  wageSegments?: Array<{
    payableMinutes: number;
    hourlyRate: number;
  }>;
}) {
  const adjustmentsTotal = (args.adjustments ?? []).reduce((sum, item) => sum + item.amount, 0);
  const otMinutes = args.overtimeMinutes ?? 0;
  const otMultiplier = args.otMultiplier ?? 1.5;

  let base = 0;
  let otAmount = 0;

  if (args.payrollType === "hourly") {
    if (args.wageSegments && args.wageSegments.length > 0) {
      base = args.wageSegments.reduce((sum, seg) => sum + (seg.payableMinutes / 60) * seg.hourlyRate, 0);
    } else {
      const rate = args.hourlyRate ?? 0;
      base = (args.payableMinutes / 60) * rate;
    }
  } else {
    // Monthly salary with standard days/hours proration
    const salary = args.monthlySalary ?? 0;
    const standardDays = args.standardMonthlyDays ?? 26;
    const standardDailyHours = args.standardDailyHours ?? 8;
    const hourlyEquivalent = standardDays > 0 && standardDailyHours > 0 ? salary / (standardDays * standardDailyHours) : 0;

    if (args.actualWorkedDays !== undefined && args.actualWorkedDays < standardDays) {
      // Prorated monthly salary
      base = (salary / standardDays) * args.actualWorkedDays;
    } else {
      base = salary;
    }

    if (otMinutes > 0 && hourlyEquivalent > 0) {
      otAmount = (otMinutes / 60) * hourlyEquivalent * otMultiplier;
    }
  }

  const roundedBase = Math.round(base);
  const roundedOt = Math.round(otAmount);
  const gross = Math.round(roundedBase + roundedOt + adjustmentsTotal);

  return {
    base: roundedBase,
    overtimeAmount: roundedOt,
    adjustments: adjustmentsTotal,
    gross,
  };
}

/**
 * Snapshot & Lock model for finalized payroll periods
 */
export type PayrollPeriodSnapshot = {
  periodId: string;
  startsOn: string;
  endsOn: string;
  lockedAt: string;
  lockedBy: string;
  employeeSnapshots: Array<{
    employeeId: string;
    payrollType: "hourly" | "monthly";
    rateApplied: number;
    regularMinutes: number;
    overtimeMinutes: number;
    baseAmount: number;
    adjustmentAmount: number;
    grossAmount: number;
  }>;
  totalGross: number;
  status: "locked" | "paid";
};
