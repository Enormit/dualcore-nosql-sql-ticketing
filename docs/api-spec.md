# PolyFlash REST API Specification (`/api/v1`)

Tài liệu đặc tả các nhóm API kết nối giữa Frontend (`S3 + CloudFront`) và Backend (`Amazon API Gateway + AWS Lambda + DynamoDB / Neon PostgreSQL`).

## Base URL
- **Local Development:** `http://localhost:3000`
- **Production (AWS API Gateway):** `https://<api-id>.execute-api.ap-southeast-1.amazonaws.com`

---

## 1. Events API (Sự kiện)
| Method | Endpoint | Mô tả | Backend Target |
| --- | --- | --- | --- |
| `GET` | `/api/v1/events` | Lấy danh sách sự kiện & trạng thái mở bán | Neon DB (`events`) |

## 2. Interactive Seat Map API (Sơ đồ ghế & Giữ chỗ)
| Method | Endpoint | Mô tả | Backend Target |
| --- | --- | --- | --- |
| `GET` | `/api/v1/events/{eventId}/seats` | Lấy sơ đồ ghế real-time (`AVAILABLE`, `HELD`, `SOLD`) | `seat-reader` -> DynamoDB |
| `POST` | `/api/v1/events/{eventId}/seats/{seatId}/hold` | Khóa ghế tạm thời 5 phút (Atomic Conditional Write) | `seat-locker` -> DynamoDB + SQS FIFO |
| `POST` | `/api/v1/events/{eventId}/seats/{seatId}/release` | Hủy giữ chỗ, nhả ghế về `AVAILABLE` | `seat-locker` -> DynamoDB |

## 3. Checkout & Tickets API (Thanh toán & Vé của tôi)
| Method | Endpoint | Mô tả | Backend Target |
| --- | --- | --- | --- |
| `POST` | `/api/v1/events/{eventId}/seats/{seatId}/pay` | Xác nhận thanh toán, ghi đơn hàng chuẩn ACID | SQS FIFO -> `order-processor` -> Neon DB |
| `GET` | `/api/v1/tickets?userId={userId}` | Lấy danh sách vé đã mua và hóa đơn thanh toán | Neon DB (`orders`, `tickets`, `payments`) |

## 4. Auth & Profile API (Xác thực & Thông tin cá nhân)
| Method | Endpoint | Mô tả | Backend Target |
| --- | --- | --- | --- |
| `POST` | `/api/v1/auth/login` | Đăng nhập và nhận JWT Token | Amazon Cognito |
| `POST` | `/api/v1/auth/register` | Đăng ký tài khoản kèm Họ tên, SĐT, Email, Địa chỉ | Amazon Cognito + Neon DB (`users`) |
| `PUT` | `/api/v1/users/profile` | Cập nhật thông tin cá nhân người dùng | Neon DB (`users`) |

## 5. Admin API (Quản trị Sự kiện & Người dùng)
| Method | Endpoint | Mô tả | Backend Target |
| --- | --- | --- | --- |
| `GET` | `/api/v1/admin/overview` | Thống kê doanh thu, danh sách người dùng & đơn hàng | Neon DB |
| `POST` | `/api/v1/admin/events` | Tạo sự kiện mới | Neon DB (`events`) |
| `PATCH` | `/api/v1/admin/events/{eventId}` | Cập nhật trạng thái mở bán sự kiện | Neon DB (`events`) |
