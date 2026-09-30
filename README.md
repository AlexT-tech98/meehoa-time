# MEEHOA TIME V1 — Hệ Thống Chấm Công & Quản Lý Lương Thực Tế

Hệ thống chấm công GPS Geofencing, xếp lịch xoay ca tuần, duyệt ngoại lệ / tăng ca và tính lương tự động dành riêng cho chuỗi tiệm hoa tươi **MEEHOA**.

---

## 1. Trạng Thái Vận Hành Hệ Thống

| Thông số | Giá trị thực tế |
| :--- | :--- |
| **Tên miền hoạt động** | [chamcong.meehoasg.com](https://chamcong.meehoasg.com) |
| **Nền tảng Hosting** | GitHub Pages (`AlexT-tech98/meehoa-time`) |
| **DNS Provider** | Hostinger (`CNAME chamcong -> alext-tech98.github.io`) |
| **Cơ sở dữ liệu** | Supabase Cloud (`https://lhgjyujbodxsdnbttkln.supabase.co`, Singapore) |
| **Chi nhánh chính** | **Meehoasg - Tiệm Hoa Tươi Bình Thạnh** |
| **Tọa độ GPS Geofence** | **Vĩ độ: 10.7932193, Kinh độ: 106.7037517** — Bán kính: **120m** |
| **Tài khoản Chủ cửa hàng** | UID: `f0c15af6-68b8-466f-a08d-0f22a32b5554` (Mã NV: `QL01`) |
| **Bộ kiểm thử tự động** | **23/23 tests PASS (100%)** bao phủ toàn bộ quy tắc nghiệp vụ |
| **Chất lượng mã nguồn** | **0 errors, 0 warnings** (Oxlint) |

---

## 2. Quy Tắc Cốt Lõi (Architecture & Core Rules)

Hệ thống được thiết kế theo mô hình 3 tầng dữ liệu tách bạch độc lập:

1. **Scheduled (Lịch phân ca)**:
   - Ma trận spreadsheet theo tuần, tự động nhận diện ngày tháng thực tế.
   - Hỗ trợ preset ca: Sáng (`S`), Chiều (`C`), Tối (`T`), Hành chính (`HC`), Cả ngày (`Full`), Nghỉ (`OFF`) hoặc giờ tùy chỉnh.
   - Hỗ trợ sao chép từ tuần trước và nhập dữ liệu hàng loạt từ file CSV.
   - Tự động phát hiện ca trùng lấn (`detectOverlappingShifts`).

2. **Actual (Chấm công thô bất biến)**:
   - Dữ liệu chấm công thô (`attendance_events`) là **Append-only**. Không ai (kể cả quản lý) có quyền sửa đổi hay xóa lượt chấm công GPS của nhân viên.
   - Kiểm tra định vị GPS Geofence theo công thức Haversine (bán kính 120m) và ngưỡng chính xác GPS < 150m.
   - Chống bấm trùng / đúp lệnh thông qua `idempotency_key` và thời gian cooldown 30 giây.

3. **Payable (Giờ tính lương thực tế sau khi duyệt)**:
   - **Ân hạn đi trễ**: Cho phép trễ tối đa 5 phút (`grace_minutes = 5`). Vượt quá 5 phút hệ thống tự động gắn cờ ngoại lệ.
   - **Tăng ca (OT)**: Không tự động cộng vào quỹ lương; chỉ khi Quản lý phê duyệt (`review_overtime`) mới chuyển thành Payable.
   - **Quên check-in / check-out**: Tự động tạm giữ công (`hold`) cho đến khi giải trình được duyệt.
   - **Lương linh hoạt**: Hỗ trợ Lương theo giờ và Lương tháng chuẩn (26 ngày / 208 giờ), tự động phân đoạn tính tỷ lệ nếu vào/nghỉ giữa tháng hoặc thay đổi bậc lương giữa kỳ (`wageSegments`).
   - **Khóa bảng lương**: Chốt snapshot bảng lương bất biến bằng RPC `lock_payroll_period()`.

---

## 3. Cấu Trúc Thư Mục Dự Án

```text
meehoa-time/
├── app/
│   ├── globals.css           # Design tokens, màu thương hiệu (#176448), mobile layout
│   ├── layout.tsx            # Metadata, viewport cấu hình PWA
│   ├── main.tsx              # SPA entry point cho Vite build
│   └── page.tsx              # Toàn bộ giao diện PWA: Overview, Schedule, Approvals, Payroll, Checkin, Settings, Profile
├── assets/                   # Compiled CSS/JS assets phục vụ GitHub Pages
├── lib/
│   ├── supabase.ts           # Supabase browser client & Realtime listeners
│   └── time-engine.ts        # Time, Geofence & Payroll Engine thuần (23 unit tests)
├── public/
│   ├── favicon.svg           # Logo chính thức của Meehoa (gradient xanh)
│   └── manifest.webmanifest  # PWA web manifest
├── supabase/
│   ├── 00_FULL_SETUP_MEEHOA_V1.sql # Master SQL migration (Schema, RLS, Realtime, RPCs)
│   ├── 01_RESET_TEST_DATA.sql      # Script dọn dẹp sạch dữ liệu test/demo
│   └── migrations/                 # Các migration versioned
├── tests/
│   └── time-engine.test.ts   # 23 unit tests kiểm thử logic kinh doanh
├── index.html                # Entry point cho GitHub Pages (chamcong.meehoasg.com)
├── CNAME                     # Định danh domain chamcong.meehoasg.com
├── package.json              # Scripts & dependencies
└── vite.static.config.ts     # Cấu hình Vite build tĩnh cho GitHub Pages
```

---

## 4. Hướng Dẫn Vận Hành Dữ Liệu

### A. Reset sạch dữ liệu test để bắt đầu vận hành mới
Khi cần dọn sạch mọi dữ liệu thử nghiệm, mở **Supabase SQL Editor** và chạy file `supabase/01_RESET_TEST_DATA.sql`:
```sql
-- Xóa toàn bộ lượt chấm công, ngoại lệ, giải trình, ca xếp, kỳ lương thử nghiệm
truncate table public.attendance_events restart identity cascade;
truncate table public.attendance_exceptions restart identity cascade;
truncate table public.explanations restart identity cascade;
truncate table public.overtime_requests restart identity cascade;
truncate table public.shifts restart identity cascade;
truncate table public.payroll_periods restart identity cascade;
truncate table public.payroll_lines restart identity cascade;
truncate table public.payroll_adjustments restart identity cascade;
truncate table public.audit_logs restart identity;
truncate table public.notification_outbox restart identity;
truncate table public.wage_histories restart identity cascade;
delete from public.profiles where role != 'owner';
```

### B. Cập nhật tọa độ GPS chi nhánh
```sql
update public.locations
set latitude = 10.7932193,
    longitude = 106.7037517,
    name = 'Meehoasg - Tiệm Hoa Tươi Bình Thạnh',
    radius_meters = 120
where organization_id = '512a620d-c36f-4bc2-8df9-c81f32892dbe';
```

### C. Mở quyền đọc thông tin chi nhánh cho trang web
```sql
drop policy if exists locations_read on public.locations;
create policy locations_read on public.locations for select using (active = true);
```

### D. Thêm nhân viên mới vào hệ thống
1. Vào **Supabase Dashboard** -> **Authentication** -> **Add user** (nhập email/password).
2. Copy mã **User UID**.
3. Chạy lệnh tạo hồ sơ trong SQL Editor:
```sql
insert into public.profiles (
  id, organization_id, employee_code, full_name, role, payroll_type, hourly_rate, monthly_salary, location_id
)
values (
  'UID_NHAN_VIEN',
  '512a620d-c36f-4bc2-8df9-c81f32892dbe',
  'NV02',
  'Tên Nhân Viên',
  'employee',
  'hourly', -- 'hourly' hoặc 'monthly'
  25000,   -- Mức lương giờ
  0,
  (select id from public.locations where organization_id = '512a620d-c36f-4bc2-8df9-c81f32892dbe' limit 1)
);
```

---

## 5. Quy Trình Build & Triển Khai (Deployment)

### Chạy tại máy cục bộ (Local Development)
```bash
npm install
npm run dev
# Mở http://localhost:3000
```

### Kiểm thử và kiểm tra chất lượng
```bash
npm test        # Chạy 23 unit tests
npm run lint    # Kiểm tra linting với Oxlint
```

### Biên dịch & Triển khai lên GitHub Pages (chamcong.meehoasg.com)
```bash
npm run build:static
git add -A
git commit -m "deploy: update production build"
git push origin main
```
Mã nguồn sẽ tự động được xuất bản trên [AlexT-tech98/meehoa-time](https://github.com/AlexT-tech98/meehoa-time) và phân phối qua mạng lưới Edge CDN của GitHub Pages.
