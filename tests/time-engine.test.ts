import { describe, expect, it } from "vitest";
import { calculatePayroll, distanceMeters, evaluateShift } from "../lib/time-engine";

const day = "2026-09-16T";
describe("Scheduled / Actual / Payable engine", () => {
  it("caps a late checkout at the scheduled end", () => {
    const r = evaluateShift({ scheduledStart: day+"12:00:00+07:00", scheduledEnd: day+"16:00:00+07:00", checkIn: day+"12:00:00+07:00", checkOut: day+"18:30:00+07:00" });
    expect(r.actualMinutes).toBe(390); expect(r.payableMinutes).toBe(240); expect(r.exceptions).toContain("unscheduled_overtime");
  });
  it("adds only approved overtime", () => {
    const r = evaluateShift({ scheduledStart: day+"12:00:00+07:00", scheduledEnd: day+"16:00:00+07:00", checkIn: day+"12:00:00+07:00", checkOut: day+"18:30:00+07:00", approvedOtMinutes:120 });
    expect(r.payableMinutes).toBe(360); expect(r.overtimeMinutes).toBe(120);
  });
  it("holds pay when a checkout is missing", () => {
    const r = evaluateShift({ scheduledStart: day+"12:00:00+07:00", scheduledEnd: day+"16:00:00+07:00", checkIn: day+"11:57:00+07:00" });
    expect(r.payableMinutes).toBe(0); expect(r.confidence).toBe("pending");
  });
  it("uses an approved explanation to recover a missing checkout", () => {
    const r = evaluateShift({ scheduledStart: day+"12:00:00+07:00", scheduledEnd: day+"16:00:00+07:00", checkIn: day+"11:57:00+07:00", approvedEnd: day+"16:05:00+07:00" });
    expect(r.payableMinutes).toBe(240); expect(r.confidence).toBe("ready");
  });
  it("flags lateness only outside grace", () => {
    const within = evaluateShift({ scheduledStart: day+"08:00:00+07:00", scheduledEnd: day+"12:00:00+07:00", checkIn: day+"08:03:00+07:00", checkOut: day+"12:00:00+07:00" });
    const late = evaluateShift({ scheduledStart: day+"08:00:00+07:00", scheduledEnd: day+"12:00:00+07:00", checkIn: day+"08:07:00+07:00", checkOut: day+"12:00:00+07:00" });
    expect(within.exceptions).not.toContain("late"); expect(late.exceptions).toContain("late");
  });
});

describe("Payroll and GPS", () => {
  it("calculates hourly and monthly payroll", () => {
    expect(calculatePayroll({ payrollType:"hourly", payableMinutes:360, hourlyRate:25000, adjustments:[50000,-20000] }).gross).toBe(180000);
    expect(calculatePayroll({ payrollType:"monthly", payableMinutes:0, monthlySalary:8000000, adjustments:[500000] }).gross).toBe(8500000);
  });
  it("computes shop geofence distance", () => {
    expect(distanceMeters({lat:10.7769,lng:106.7009},{lat:10.7769,lng:106.7009})).toBe(0);
  });
});
