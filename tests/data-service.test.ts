import { describe, it, expect } from 'vitest';
import {
  getSession,
  fetchProfile,
  fetchTodayAttendance,
  ApprovalItemData,
} from '../lib/data-service';

describe('Data Service Layer Unit Tests', () => {
  it('getSession returns null when unauthenticated', async () => {
    const session = await getSession();
    expect(session).toBeNull();
  });

  it('fetchProfile returns null when unauthenticated due to RLS', async () => {
    const profile = await fetchProfile('non-existent-user-id');
    expect(profile).toBeNull();
  });

  it('fetchTodayAttendance returns empty array when no events for employee', async () => {
    const events = await fetchTodayAttendance('test-emp-id');
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBe(0);
  });

  it('ApprovalItemData data structure matches expectation', () => {
    const item: ApprovalItemData = {
      id: 'ot-1',
      shiftId: 'shift-1',
      employeeId: 'emp-1',
      employeeName: 'Nguyễn Văn A',
      kind: 'overtime',
      typeLabel: 'Tăng ca (OT)',
      dateStr: '01/10',
      shiftTime: '10:00–18:00',
      evidence: 'Đề xuất +60 phút',
      reason: 'Làm thêm ca tối',
      requestedPayable: '+1h',
      proposedMinutes: 60,
      status: 'pending',
    };

    expect(item.kind).toBe('overtime');
    expect(item.proposedMinutes).toBe(60);
    expect(item.status).toBe('pending');
  });
});
