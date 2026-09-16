# MEEHOA TIME V1

Web app/PWA mobile-first cho shop hoa: lịch xoay ca linh động, chấm công GPS, phân tách Scheduled / Actual / Payable, giải trình và duyệt ngoại lệ, OT, payroll theo giờ hoặc theo tháng, audit log và quỹ lương realtime.

## Chạy thử

Yêu cầu Node.js 22.13+.

```bash
npm install
npm run dev
```

Không có biến môi trường, giao diện tự chạy ở **demo mode** với dữ liệu mẫu benchmark từ lịch xoay ca hiện tại. Các nút duyệt, từ chối, chấm công GPS và điều hướng đều có thể thử trực tiếp.

## Kết nối Supabase

1. Tạo một Supabase project mới, chọn region gần Việt Nam.
2. Trong SQL Editor, chạy lần lượt:
   - `supabase/migrations/202609160001_initial_schema.sql`
   - `supabase/migrations/202609160002_functions.sql`
3. Tạo file `.env.local` từ `.env.example`, điền Project URL và anon key.
4. Trong Supabase Auth tạo user đầu tiên. Tạo một `organizations` record, rồi một `profiles` record có cùng `id` với Auth user và role `owner`.
5. Tạo `locations` cho shop, cấu hình GPS/rule trong `settings`, sau đó mời nhân viên qua Supabase Auth.

Schema bật RLS cho toàn bộ dữ liệu. Nhân viên chỉ xem lịch, chấm công và gửi giải trình/OT của chính mình; owner/admin quản lý lịch, duyệt và payroll. Raw attendance chỉ được thêm, không có policy sửa/xóa từ client. RPC `capture_attendance` ghi sự kiện idempotent, kiểm tra geofence và audit trong cùng transaction.

## Quy tắc lõi

- Lịch ngày là nguồn chuẩn; ca mẫu chỉ để nhập nhanh, vẫn cho phép giờ tùy ý.
- Actual giữ nguyên dữ liệu check-in/out.
- Payable được giới hạn trong lịch. Checkout muộn không tự thành OT.
- Thiếu check-in/out giữ công ở pending cho đến khi giải trình được duyệt.
- Chỉ OT đã duyệt mới cộng Payable.
- Payroll chỉ đọc Payable; điều chỉnh là dòng riêng có audit.
- Quy tắc đi trễ được lưu như attendance policy/violation, không hard-code khấu trừ lương.

## Test và build

```bash
npm test
npm run lint
npm run build
```

Test bao phủ checkout muộn, OT duyệt, thiếu checkout, giải trình được duyệt, grace period, lương hourly/monthly và khoảng cách GPS.

## Deploy

### Vercel

Import repo, giữ build command `npm run build`, thêm hai biến `NEXT_PUBLIC_SUPABASE_URL` và `NEXT_PUBLIC_SUPABASE_ANON_KEY`, rồi deploy.

### Cloudflare / Sites

Build hiện tại xuất Cloudflare Worker-compatible ESM. Khai báo hai biến Supabase ở phần runtime environment của host, build và publish. Không đưa service-role key vào frontend.

## Cấu trúc chính

- `app/`: giao diện PWA responsive và demo tương tác.
- `lib/time-engine.ts`: Time/Payroll/GPS engine thuần, dễ test.
- `lib/supabase.ts`: Supabase browser client và Realtime.
- `supabase/migrations/`: schema, RLS, realtime, attendance RPC và payroll fund view.
- `tests/`: các case nghiệp vụ chính.

## Trước khi dùng thật

Điền tọa độ/radius shop, kiểm tra nội quy lao động và cách xử lý vi phạm đi trễ với đơn vị tư vấn phù hợp; hệ thống mặc định chỉ flag vi phạm. Bật email/OTP Auth, đặt Site URL/redirect URL, kiểm tra RLS bằng tài khoản owner và employee riêng, rồi mới nhập dữ liệu nhân sự thật.
