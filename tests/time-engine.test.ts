import { describe, expect, it } from 'vitest';
import {
  applyRounding,
  calculatePayroll,
  detectOverlappingShifts,
  distanceMeters,
  evaluateShift,
  isDuplicatePunch,
  type PayrollPeriodSnapshot,
} from '../lib/time-engine';

const day = '2026-09-16T';

describe('MEEHOA TIME V1 - Comprehensive Time Engine Suite', () => {
  describe('Scheduled / Actual / Payable Separation & Exceptions', () => {
    it('1. Check-in đúng giờ: captures exact duration and zero exceptions', () => {
      const r = evaluateShift({
        scheduledStart: day + '08:00:00+07:00',
        scheduledEnd: day + '16:00:00+07:00',
        checkIn: day + '08:00:00+07:00',
        checkOut: day + '16:00:00+07:00',
      });
      expect(r.scheduledMinutes).toBe(480);
      expect(r.actualMinutes).toBe(480);
      expect(r.payableMinutes).toBe(480);
      expect(r.lateMinutes).toBe(0);
      expect(r.earlyLeaveMinutes).toBe(0);
      expect(r.exceptions).toHaveLength(0);
      expect(r.confidence).toBe('ready');
    });

    it('2. Đi trễ trong grace period: no late exception raised', () => {
      const r = evaluateShift({
        scheduledStart: day + '08:00:00+07:00',
        scheduledEnd: day + '12:00:00+07:00',
        checkIn: day + '08:04:00+07:00',
        checkOut: day + '12:00:00+07:00',
        graceMinutes: 5,
      });
      expect(r.lateMinutes).toBe(4);
      expect(r.exceptions).not.toContain('late');
      expect(r.payableMinutes).toBe(236);
    });

    it('3. Đi trễ ngoài grace period: flags late exception', () => {
      const r = evaluateShift({
        scheduledStart: day + '08:00:00+07:00',
        scheduledEnd: day + '12:00:00+07:00',
        checkIn: day + '08:12:00+07:00',
        checkOut: day + '12:00:00+07:00',
        graceMinutes: 5,
      });
      expect(r.lateMinutes).toBe(12);
      expect(r.exceptions).toContain('late');
      expect(r.payableMinutes).toBe(228);
    });

    it('4. Check-out sớm: flags early_leave when beyond grace period', () => {
      const r = evaluateShift({
        scheduledStart: day + '10:00:00+07:00',
        scheduledEnd: day + '18:00:00+07:00',
        checkIn: day + '10:00:00+07:00',
        checkOut: day + '17:40:00+07:00',
        graceMinutes: 5,
      });
      expect(r.earlyLeaveMinutes).toBe(20);
      expect(r.exceptions).toContain('early_leave');
      expect(r.payableMinutes).toBe(460);
    });

    it('5. Check-out muộn không có OT: caps payable at scheduled end and flags unscheduled_overtime', () => {
      const r = evaluateShift({
        scheduledStart: day + '12:00:00+07:00',
        scheduledEnd: day + '16:00:00+07:00',
        checkIn: day + '12:00:00+07:00',
        checkOut: day + '18:30:00+07:00',
      });
      expect(r.actualMinutes).toBe(390);
      expect(r.regularMinutes).toBe(240);
      expect(r.payableMinutes).toBe(240);
      expect(r.overtimeMinutes).toBe(0);
      expect(r.exceptions).toContain('unscheduled_overtime');
    });

    it('6. OT được duyệt: adds approved overtime to payableMinutes', () => {
      const r = evaluateShift({
        scheduledStart: day + '12:00:00+07:00',
        scheduledEnd: day + '16:00:00+07:00',
        checkIn: day + '12:00:00+07:00',
        checkOut: day + '18:30:00+07:00',
        approvedOtMinutes: 120,
      });
      expect(r.payableMinutes).toBe(360);
      expect(r.overtimeMinutes).toBe(120);
      expect(r.exceptions).not.toContain('unscheduled_overtime');
    });

    it('7. OT bị từ chối: rejected overtime is not added to payable and does not flag unscheduled_overtime', () => {
      const r = evaluateShift({
        scheduledStart: day + '12:00:00+07:00',
        scheduledEnd: day + '16:00:00+07:00',
        checkIn: day + '12:00:00+07:00',
        checkOut: day + '18:30:00+07:00',
        otRejected: true,
      });
      expect(r.payableMinutes).toBe(240);
      expect(r.overtimeMinutes).toBe(0);
      expect(r.exceptions).not.toContain('unscheduled_overtime');
    });

    it('8. Thiếu check-in: holds pay (0 payable) and marks confidence pending', () => {
      const r = evaluateShift({
        scheduledStart: day + '08:00:00+07:00',
        scheduledEnd: day + '16:00:00+07:00',
        checkOut: day + '16:00:00+07:00',
      });
      expect(r.exceptions).toContain('missing_check_in');
      expect(r.payableMinutes).toBe(0);
      expect(r.confidence).toBe('pending');
    });

    it('9. Thiếu check-out: holds pay (0 payable) and marks confidence pending', () => {
      const r = evaluateShift({
        scheduledStart: day + '10:00:00+07:00',
        scheduledEnd: day + '18:00:00+07:00',
        checkIn: day + '09:58:00+07:00',
      });
      expect(r.exceptions).toContain('missing_check_out');
      expect(r.payableMinutes).toBe(0);
      expect(r.confidence).toBe('pending');
    });

    it('10. Giải trình được duyệt: uses approved times to recover missing punch', () => {
      const r = evaluateShift({
        scheduledStart: day + '10:00:00+07:00',
        scheduledEnd: day + '18:00:00+07:00',
        checkIn: day + '09:58:00+07:00',
        approvedEnd: day + '18:02:00+07:00',
      });
      expect(r.exceptions).not.toContain('missing_check_out');
      expect(r.payableMinutes).toBe(480);
      expect(r.confidence).toBe('ready');
    });

    it('11. Giải trình bị từ chối: maintains pending status when no approved override', () => {
      const r = evaluateShift({
        scheduledStart: day + '10:00:00+07:00',
        scheduledEnd: day + '18:00:00+07:00',
        checkIn: day + '10:00:00+07:00',
        approvedEnd: null,
      });
      expect(r.confidence).toBe('pending');
      expect(r.payableMinutes).toBe(0);
    });

    it('12. Ca qua ngày: properly calculates overnight shift spanning midnight', () => {
      const r = evaluateShift({
        scheduledStart: '2026-09-16T22:00:00+07:00',
        scheduledEnd: '2026-09-17T06:00:00+07:00',
        checkIn: '2026-09-16T22:00:00+07:00',
        checkOut: '2026-09-17T06:00:00+07:00',
      });
      expect(r.scheduledMinutes).toBe(480);
      expect(r.actualMinutes).toBe(480);
      expect(r.payableMinutes).toBe(480);
      expect(r.exceptions).toHaveLength(0);
    });

    it('13. Ca chồng lấn: detects overlapping shifts for the same person', () => {
      const shifts = [
        {
          id: 'shift-1',
          startsAt: day + '08:00:00+07:00',
          endsAt: day + '14:00:00+07:00',
        },
        {
          id: 'shift-2',
          startsAt: day + '13:00:00+07:00',
          endsAt: day + '18:00:00+07:00',
        },
        {
          id: 'shift-3',
          startsAt: day + '19:00:00+07:00',
          endsAt: day + '22:00:00+07:00',
        },
      ];
      const overlaps = detectOverlappingShifts(shifts);
      expect(overlaps).toHaveLength(1);
      expect(overlaps[0]).toEqual({ shiftA: 'shift-1', shiftB: 'shift-2' });
    });

    it('14. Rounding rule: rounds payable minutes according to rule (e.g. 15 minutes)', () => {
      expect(applyRounding(243, 15)).toBe(240);
      expect(applyRounding(248, 15)).toBe(255);
      expect(applyRounding(242, 5)).toBe(240);
    });
  });

  describe('GPS Geofence & Idempotency', () => {
    const shopLocation = { lat: 10.7769, lng: 106.7009 };

    it('15. Khoảng cách GPS trong vùng: check-in is verified within radius', () => {
      const closePoint = { lat: 10.777, lng: 106.701, accuracy: 15 };
      const dist = distanceMeters(shopLocation, closePoint);
      expect(dist).toBeLessThan(120);

      const r = evaluateShift({
        scheduledStart: day + '08:00:00+07:00',
        scheduledEnd: day + '12:00:00+07:00',
        checkIn: day + '08:00:00+07:00',
        checkOut: day + '12:00:00+07:00',
        shopLocation,
        shopRadiusMeters: 120,
        checkInGps: closePoint,
      });
      expect(r.exceptions).not.toContain('outside_geofence');
      expect(r.checkInWithinGeofence).toBe(true);
    });

    it('16. Khoảng cách GPS ngoài vùng: flags outside_geofence exception', () => {
      const farPoint = { lat: 10.785, lng: 106.71, accuracy: 20 }; // ~1.3km away
      const dist = distanceMeters(shopLocation, farPoint);
      expect(dist).toBeGreaterThan(500);

      const r = evaluateShift({
        scheduledStart: day + '08:00:00+07:00',
        scheduledEnd: day + '12:00:00+07:00',
        checkIn: day + '08:00:00+07:00',
        checkOut: day + '12:00:00+07:00',
        shopLocation,
        shopRadiusMeters: 120,
        checkInGps: farPoint,
      });
      expect(r.exceptions).toContain('outside_geofence');
      expect(r.checkInWithinGeofence).toBe(false);
    });

    it('17. Accuracy GPS quá thấp: flags low_gps_accuracy exception', () => {
      const inaccuratePoint = { lat: 10.7769, lng: 106.7009, accuracy: 250 }; // accuracy 250m > 100m threshold
      const r = evaluateShift({
        scheduledStart: day + '08:00:00+07:00',
        scheduledEnd: day + '12:00:00+07:00',
        checkIn: day + '08:00:00+07:00',
        checkOut: day + '12:00:00+07:00',
        shopLocation,
        maxGpsAccuracyMeters: 100,
        checkInGps: inaccuratePoint,
      });
      expect(r.exceptions).toContain('low_gps_accuracy');
    });

    it('18. Chấm công trùng/idempotency: detects duplicate punches within cooldown', () => {
      const punches = [
        { event: 'check_in' as const, occurredAt: '2026-09-16T08:00:05+07:00' },
      ];
      const dup = {
        event: 'check_in' as const,
        occurredAt: '2026-09-16T08:00:20+07:00',
      };
      const nonDup = {
        event: 'check_in' as const,
        occurredAt: '2026-09-16T08:05:00+07:00',
      };

      expect(isDuplicatePunch(punches, dup, 60)).toBe(true);
      expect(isDuplicatePunch(punches, nonDup, 60)).toBe(false);
    });
  });

  describe('Payroll Engine (Hourly, Monthly, Adjustments, Snapshots)', () => {
    it('19. Hourly payroll: accurate gross from payable hours and rate', () => {
      const payroll = calculatePayroll({
        payrollType: 'hourly',
        payableMinutes: 480, // 8 hours
        hourlyRate: 30000,
        adjustments: [
          { amount: 50000, category: 'bonus' },
          { amount: -20000, category: 'attendance_violation' },
        ],
      });
      expect(payroll.base).toBe(240000);
      expect(payroll.adjustments).toBe(30000);
      expect(payroll.gross).toBe(270000);
    });

    it('20. Monthly payroll: full standard salary with approved OT', () => {
      const payroll = calculatePayroll({
        payrollType: 'monthly',
        payableMinutes: 208 * 60,
        monthlySalary: 7800000,
        standardMonthlyDays: 26,
        standardDailyHours: 8, // hourly equivalent = 7,800,000 / 208 = 37,500đ/h
        overtimeMinutes: 120, // 2 hours OT at 1.5x = 2 * 37,500 * 1.5 = 112,500đ
        adjustments: [{ amount: 300000, category: 'allowance' }],
      });
      expect(payroll.base).toBe(7800000);
      expect(payroll.overtimeAmount).toBe(112500);
      expect(payroll.gross).toBe(7800000 + 112500 + 300000);
    });

    it('21. Monthly payroll prorated: calculates mid-month hire or leave', () => {
      const payroll = calculatePayroll({
        payrollType: 'monthly',
        payableMinutes: 13 * 8 * 60,
        monthlySalary: 7800000,
        standardMonthlyDays: 26,
        actualWorkedDays: 13, // half month
      });
      expect(payroll.base).toBe(3900000);
      expect(payroll.gross).toBe(3900000);
    });

    it('22. Mức lương thay đổi giữa kỳ: wage segments calculate accurately across rate transition', () => {
      const payroll = calculatePayroll({
        payrollType: 'hourly',
        payableMinutes: 600,
        wageSegments: [
          { payableMinutes: 300, hourlyRate: 25000 }, // 5 hours @ 25k = 125,000
          { payableMinutes: 300, hourlyRate: 30000 }, // 5 hours @ 30k = 150,000
        ],
      });
      expect(payroll.base).toBe(275000);
      expect(payroll.gross).toBe(275000);
    });

    it('23. Payroll snapshot and lock: verifies snapshot integrity', () => {
      const snapshot: PayrollPeriodSnapshot = {
        periodId: 'p-2026-09',
        startsOn: '2026-09-01',
        endsOn: '2026-09-30',
        lockedAt: '2026-10-01T10:00:00Z',
        lockedBy: 'owner-1',
        employeeSnapshots: [
          {
            employeeId: 'emp-1',
            payrollType: 'hourly',
            rateApplied: 25000,
            regularMinutes: 6000, // 100 hours
            overtimeMinutes: 300, // 5 hours
            baseAmount: 2500000,
            adjustmentAmount: 100000,
            grossAmount: 2600000,
          },
        ],
        totalGross: 2600000,
        status: 'locked',
      };

      expect(snapshot.status).toBe('locked');
      expect(snapshot.employeeSnapshots[0].grossAmount).toBe(
        snapshot.employeeSnapshots[0].baseAmount +
          snapshot.employeeSnapshots[0].adjustmentAmount,
      );
      expect(snapshot.totalGross).toBe(2600000);
    });
  });
});
