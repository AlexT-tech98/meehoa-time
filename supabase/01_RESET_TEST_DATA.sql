-- ==============================================================================
-- MEEHOA TIME V1 - SAFE DATABASE RESET SCRIPT
-- Chạy script này trong Supabase SQL Editor khi muốn xóa sạch dữ liệu test/demo
-- để bắt đầu vận hành chính thức từ đầu.
-- LƯU Ý: Script này GIỮ NGUYÊN cấu trúc bảng, RLS, tổ chức MEEHOA và tài khoản Chủ quán.
-- ==============================================================================

-- 1. Xóa toàn bộ lịch sử chấm công, ngoại lệ và tăng ca
truncate table public.attendance_events restart identity cascade;
truncate table public.attendance_exceptions restart identity cascade;
truncate table public.explanations restart identity cascade;
truncate table public.overtime_requests restart identity cascade;

-- 2. Xóa toàn bộ ca làm việc đã xếp
truncate table public.shifts restart identity cascade;

-- 3. Xóa các kỳ tính lương, dòng lương và phụ cấp
truncate table public.payroll_periods restart identity cascade;
truncate table public.payroll_lines restart identity cascade;
truncate table public.payroll_adjustments restart identity cascade;

-- 4. Xóa nhật ký kiểm toán và hàng đợi thông báo
truncate table public.audit_logs restart identity;
truncate table public.notification_outbox restart identity;

-- 5. Xóa lịch sử thay đổi bậc lương test
truncate table public.wage_histories restart identity cascade;

-- 6. Xóa các nhân viên test, chỉ giữ lại tài khoản Chủ cửa hàng (Owner)
delete from public.profiles where role != 'owner';
