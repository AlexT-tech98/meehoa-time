export type ShiftInput = {
  scheduledStart: string;
  scheduledEnd: string;
  checkIn?: string | null;
  checkOut?: string | null;
  approvedStart?: string | null;
  approvedEnd?: string | null;
  approvedOtMinutes?: number;
  graceMinutes?: number;
};

export type ShiftResult = {
  scheduledMinutes: number;
  actualMinutes: number;
  payableMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  exceptions: Array<"missing_check_in" | "missing_check_out" | "late" | "early_leave" | "unscheduled_overtime">;
  confidence: "ready" | "pending";
};

const minutes = (iso: string) => new Date(iso).getTime() / 60000;
const duration = (from: string, to: string) => Math.max(0, Math.round(minutes(to) - minutes(from)));

export function evaluateShift(input: ShiftInput): ShiftResult {
  const grace = input.graceMinutes ?? 5;
  const exceptions: ShiftResult["exceptions"] = [];
  const scheduledMinutes = duration(input.scheduledStart, input.scheduledEnd);
  if (!input.checkIn) exceptions.push("missing_check_in");
  if (!input.checkOut) exceptions.push("missing_check_out");
  const actualMinutes = input.checkIn && input.checkOut ? duration(input.checkIn, input.checkOut) : 0;
  const lateMinutes = input.checkIn ? Math.max(0, Math.round(minutes(input.checkIn) - minutes(input.scheduledStart))) : 0;
  const earlyLeaveMinutes = input.checkOut ? Math.max(0, Math.round(minutes(input.scheduledEnd) - minutes(input.checkOut))) : 0;
  if (lateMinutes > grace) exceptions.push("late");
  if (earlyLeaveMinutes > grace) exceptions.push("early_leave");
  if (input.checkOut && minutes(input.checkOut) > minutes(input.scheduledEnd) && !input.approvedOtMinutes) exceptions.push("unscheduled_overtime");

  const effectiveStart = input.approvedStart ?? input.checkIn;
  const effectiveEnd = input.approvedEnd ?? input.checkOut;
  let regularMinutes = 0;
  if (effectiveStart && effectiveEnd) {
    const clampedStart = Math.max(minutes(effectiveStart), minutes(input.scheduledStart));
    const clampedEnd = Math.min(minutes(effectiveEnd), minutes(input.scheduledEnd));
    regularMinutes = Math.max(0, Math.round(clampedEnd - clampedStart));
  }
  const overtimeMinutes = Math.max(0, input.approvedOtMinutes ?? 0);
  const unresolvedMissing = (!input.checkIn && !input.approvedStart) || (!input.checkOut && !input.approvedEnd);
  return {
    scheduledMinutes,
    actualMinutes,
    payableMinutes: unresolvedMissing ? 0 : regularMinutes + overtimeMinutes,
    regularMinutes: unresolvedMissing ? 0 : regularMinutes,
    overtimeMinutes: unresolvedMissing ? 0 : overtimeMinutes,
    lateMinutes,
    earlyLeaveMinutes,
    exceptions,
    confidence: unresolvedMissing ? "pending" : "ready",
  };
}

export function calculatePayroll(args: { payrollType: "hourly" | "monthly"; payableMinutes: number; hourlyRate?: number; monthlySalary?: number; adjustments?: number[] }) {
  const base = args.payrollType === "hourly" ? (args.payableMinutes / 60) * (args.hourlyRate ?? 0) : (args.monthlySalary ?? 0);
  const adjustments = (args.adjustments ?? []).reduce((sum, value) => sum + value, 0);
  return { base: Math.round(base), adjustments, gross: Math.round(base + adjustments) };
}

export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = 6371000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(x));
}
