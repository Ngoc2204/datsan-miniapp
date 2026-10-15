# DatSan

Monorepo MVP DatSan: API NestJS/PostgreSQL, cổng quản trị chủ sân/admin bằng React và giao diện khách tối ưu cho Zalo Mini App.

## Yêu cầu

- Node.js 22.12 trở lên.
- npm.
- Docker Desktop hoặc Docker Engine có hỗ trợ Docker Compose.

## Chạy local trên PowerShell

1. Tạo file cấu hình local:
   Copy-Item .env.example .env
2. Cài dependencies:
   rtk npm install
3. Khởi động PostgreSQL:
   rtk docker compose up -d postgres
4. Tạo schema và nạp bốn môn thể thao ban đầu:
   rtk npm run db:migrate
5. Đặt JWT_SECRET, ADMIN_EMAIL và ADMIN_PASSWORD trong .env.
6. Tạo tài khoản admin đầu tiên:
   rtk npm run db:seed:admin
7. Chạy API:
   rtk npm run dev:api
8. Chạy giao diện: `rtk npm run dev:web` rồi mở địa chỉ Vite hiện ra (mặc định http://localhost:5173).
   Cổng admin tổng có giao diện riêng tại http://localhost:5173/admin/; URL sẽ dùng cùng cổng Vite nếu 5173 đã bận.
9. Mở http://localhost:3000/api/v1/health để xem trạng thái API và PostgreSQL.
10. Gọi GET http://localhost:3000/api/v1/sports để lấy danh mục môn thể thao đang hoạt động.

Kiểm tra luồng MVP bằng `rtk npm run test:mvp` sau khi PostgreSQL đã chạy. Lệnh này tạo schema PostgreSQL riêng, chạy migrations và kiểm tra đăng ký/duyệt chủ sân, cấu hình/duyệt địa điểm, tìm giờ trống, đặt và hủy sân, thanh toán demo, email outbox, phân quyền và ghép kèo. Schema thử nghiệm được xóa khi lệnh kết thúc.

Các lệnh theo quy ước RTK của workspace. Không commit file .env. Thư mục .tailieu được loại khỏi Git bằng .gitignore.

## Database production trên Neon

- Cấu hình `DATABASE_URL` của API Render bằng connection string của Neon; không commit connection string hoặc secret vào Git.
- `npm run start:render` chạy migrations rồi khởi động API. Migrations được theo dõi trong `schema_migrations` và có thể chạy lại an toàn.
- Seed admin và dữ liệu sân mẫu không tự chạy khi service khởi động. Chạy `npm run db:seed:admin` một lần khi cần tạo/khởi tạo admin; đặt `ADMIN_EMAIL` và `ADMIN_PASSWORD` trong môi trường chạy seed.
- `npm run db:seed:venues` chỉ dùng khi chủ động muốn thêm dữ liệu sân mẫu vào đúng database. Không chạy lệnh này với Neon production nếu không muốn tạo dữ liệu mẫu.
- Sao lưu database trước khi chạy migration có thể thay đổi hoặc xóa dữ liệu.

## Cấu trúc hiện tại

- apps/api: API NestJS.
- apps/web: giao diện React dùng chung cho khách, chủ sân và admin; có cấu hình Zalo Mini App trong `app-config.json`.
- apps/api/database/migrations: SQL migrations cho PostgreSQL.
- apps/api/scripts: công cụ chạy migration.
- compose.yaml: PostgreSQL local.
- .env.example: cấu hình mẫu không chứa secret production.

## Luồng MVP đã triển khai

Giao diện kết nối các luồng đăng nhập khách/Zalo và đăng ký chủ sân; duyệt hồ sơ/doanh nghiệp/địa điểm; cấu hình sân, giờ và giá; tìm địa điểm và khung giờ; đặt tại sân/thanh toán demo; lịch của khách; ghép kèo; lịch vận hành, đặt thủ công, khóa giờ và phân công nhân viên; quản trị môn, tài khoản, báo cáo và nhật ký.

Để gắn ứng dụng với tài khoản Mini App của bạn, chạy `rtk npx zmp init` bên trong `apps/web` và nhập Mini App ID hợp lệ. `apps/web/app-config.json` đã khai báo tài nguyên với tên file ổn định để deploy sau khi build.

## Giao diện khách, chủ sân và admin

- Chạy API tại `http://localhost:3000`, sau đó giao diện bằng `rtk npm run dev:web`.
- Khách và chủ sân dùng `/`; quản trị viên nền tảng dùng `/admin/`. Admin đăng nhập bằng tài khoản tạo qua `rtk npm run db:seed:admin`; tài khoản khác không vào được cổng này. API vẫn kiểm tra quyền admin trên từng yêu cầu.
- `rtk npm run build:web` tạo gói khách/Mini App trong `apps/web/dist`; `rtk npm run build:admin` tạo gói admin riêng trong `apps/web/dist-admin`.
- Tạo `.env` từ `.env.example`; `VITE_API_URL` trỏ giao diện tới API.
- Để liên kết Mini App thật, chạy `rtk npx zmp init` trong `apps/web` và nhập Mini App ID của bạn. Đăng nhập Zalo cần chạy trong Zalo Mini App thật; trình duyệt thường chỉ xem được giao diện.
## Auth và duyệt hồ sơ chủ sân

- POST /api/v1/auth/business/register: tạo tài khoản chủ sân, doanh nghiệp chờ duyệt và phiên đăng nhập.
- POST /api/v1/auth/login: đăng nhập bằng email/mật khẩu.
- GET /api/v1/auth/me: xem tài khoản hiện tại (Bearer token).
- GET /api/v1/admin/businesses?status=pending_review: danh sách hồ sơ chờ duyệt (admin).
- PATCH /api/v1/admin/businesses/:id/review: duyệt, từ chối hoặc tạm khóa hồ sơ (admin).

Tài khoản admin chỉ được tạo bằng lệnh seed local; API đăng ký công khai không thể tự cấp quyền admin.

## Cổng chủ sân và duyệt địa điểm

- GET /api/v1/owner/businesses: xem doanh nghiệp và trạng thái duyệt.
- POST /api/v1/owner/businesses/:businessId/venues: tạo địa điểm nháp và bật danh mục môn.
- POST /api/v1/owner/businesses/:businessId/venues/:venueId/courts: cấu hình sân, thời lượng, giờ hoạt động và giá.
- POST /api/v1/owner/businesses/:businessId/venues/:venueId/submit: gửi địa điểm đủ cấu hình để admin duyệt.
- GET /api/v1/admin/venues?status=pending_review và PATCH /api/v1/admin/venues/:id/review: admin duyệt, từ chối hoặc tạm khóa địa điểm.

## Khám phá và đặt sân

- GET /api/v1/venues: tìm địa điểm đã duyệt theo môn, tên/khu vực, giá và tọa độ.
- Bộ lọc tìm sân hỗ trợ `date=YYYY-MM-DD`, `startTime=HH:mm`, `durationMinutes` (mặc định theo từng sân) và `maxDistanceKm` (cần `latitude` và `longitude`). Khi có ngày, backend chỉ trả địa điểm có ít nhất một sân còn trống, có giá và không bị khóa trong khung giờ phù hợp. Chạy `rtk npm run test:explore` để kiểm tra bộ lọc với dữ liệu tạm được rollback sau khi test.
- GET /api/v1/venues/:venueId: xem địa điểm, sân, giờ mở cửa và bảng giá.
- GET /api/v1/venues/:venueId/courts/:courtId/availability?date=YYYY-MM-DD: lấy giờ còn trống và giá backend tính.
- POST /api/v1/bookings/courts/:courtId: tạo booking thanh toán tại sân hoặc giữ chỗ thanh toán demo (Bearer token).
- GET /api/v1/bookings/mine, POST /api/v1/bookings/:bookingId/cancel: xem và hủy lịch của khách.
- POST /api/v1/bookings/:bookingId/demo-payment: mô phỏng kết quả thanh toán demo.

Email xác nhận và nhắc lịch được ghi vào PostgreSQL outbox trong cùng giao dịch booking. SMTP cấu hình qua SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD và MAIL_FROM; khi chưa cấu hình, email giữ ở trạng thái chờ.

## Ghép kèo cộng đồng

- GET /api/v1/community/games: tìm kèo sắp tới.
- POST /api/v1/community/games: tạo kèo; organizer tự được tính là người tham gia đầu tiên.
- POST /api/v1/community/games/:gameId/join và DELETE /api/v1/community/games/:gameId/join: tham gia hoặc rời kèo.
- POST /api/v1/community/games/:gameId/close: người tổ chức đóng kèo.
- POST /api/v1/community/games/:gameId/report: báo cáo nội dung.
- GET /api/v1/admin/community/reports và PATCH /api/v1/admin/community/reports/:id/review: admin xử lý báo cáo.

- GET /api/v1/owner/businesses/:businessId/bookings?from=YYYY-MM-DD&to=YYYY-MM-DD: xem lịch trong tối đa 31 ngày; nhân viên chỉ thấy địa điểm được phân công.
- POST /api/v1/owner/businesses/:businessId/bookings/manual: tạo booking tại quầy theo cùng nguồn lịch và quy tắc giá.
- PATCH /api/v1/owner/businesses/:businessId/bookings/:bookingId: hủy hoặc hoàn tất booking theo quyền và trạng thái.

- PATCH /api/v1/owner/businesses/:businessId/venues/:venueId: chỉnh thông tin địa điểm nháp/bị trả về trước khi gửi duyệt lại.
- POST /api/v1/owner/businesses/:businessId/courts/:courtId/blocks và DELETE /api/v1/owner/businesses/:businessId/blocks/:blockId: khóa/mở khung giờ; không khóa chồng booking đang hiệu lực.

Admin có GET /api/v1/admin/dashboard, CRUD cơ bản môn thể thao tại /api/v1/admin/sports và tra cứu/khóa tài khoản tại /api/v1/admin/users. Danh mục môn dùng dữ liệu PostgreSQL; các API địa điểm và ghép kèo kiểm tra mã môn đang hoạt động ở backend.

- POST /api/v1/auth/zalo: nhận access token Mini App, backend xác minh hồ sơ với Zalo rồi cấp JWT DatSan.
- POST /api/v1/auth/customer/register và /api/v1/auth/login: tài khoản email/mật khẩu dùng cho cổng web và demo API.

- PATCH /api/v1/owner/businesses/:businessId/courts/:courtId/configuration: cập nhật giờ, giá và thời lượng; backend từ chối cấu hình làm mất giờ của booking tương lai.

- GET/POST /api/v1/owner/businesses/:businessId/staff: xem và phân công tài khoản đã đăng ký vào địa điểm.
- DELETE /api/v1/owner/businesses/:businessId/staff/:venueId/:userId: thu hồi quyền tại địa điểm; membership bị tắt nếu không còn phân công nào.

- GET /api/v1/owner/businesses/:businessId/reports?from=YYYY-MM-DD&to=YYYY-MM-DD: tổng hợp lượt đặt và giá trị đặt sân trong tối đa 31 ngày (chủ sở hữu/quản lý).
