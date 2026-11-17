# PolyFlash — Hệ thống Đặt vé Sự kiện & Flash Sale (Dual-Core NoSQL + SQL)

**PolyFlash** là nền tảng đặt vé sự kiện chịu tải cao được thiết kế theo kiến trúc **Cloud-Native**, hướng sự kiện (**Event-Driven**) và lưu trữ dữ liệu lai (**Polyglot Persistence**):
- **Amazon DynamoDB (NoSQL):** Đọc sơ đồ ghế tốc độ mili-giây và khóa ghế nguyên tử (`Conditional Write` + `TTL 5 phút`) chống bán trùng vé.
- **Neon Serverless PostgreSQL (SQL):** Lưu trữ giao dịch tài chính chuẩn **ACID** (`events`, `orders`, `tickets`, `payments`, `users`) thông qua **PgBouncer Pooler**.
- **Amazon SQS FIFO + DLQ:** Bộ đệm hấp thụ truy cập đột biến trong các đợt Flash Sale, bảo vệ kết nối Neon DB.
- **AWS Systems Manager (SSM Parameter Store):** Lưu trữ bí mật dạng `SecureString` và nạp động qua IAM Least Privilege.
- **Observability & ChatOps:** CloudWatch Alarms + SNS + Lambda Alert Forwarder gửi cảnh báo trực tiếp về Telegram.

---

## 1. Cấu trúc Dự án

```text
dualcore-nosql-sql-ticketing/
├── db/                     # SQL migrations (Neon Direct URL), seed data & DynamoDB schema
├── docs/                   # Đặc tả API (/api/v1)
├── frontend/               # Giao diện đa trang (S3 + CloudFront): Lobby, Seat Map, Checkout, Tickets, Admin, Auth
├── infra/                  # Modular Terraform IaC (storage, messaging, auth, frontend, compute, api, monitoring, cicd)
├── scripts/                # Công cụ hỗ trợ phát triển
├── services/               # 4 AWS Lambda microservices (seat-reader, seat-locker, order-processor, alert-forwarder)
└── tests/load-test/        # Kịch bản giả tải & kiểm thử tranh chấp Flash Sale trên AWS Cloud
```

---

## 2. Hạ tầng Cloud Đang Vận Hành (AWS `ap-southeast-1` + Neon DB)

- **Frontend CDN (CloudFront + S3):** `https://d13el8mejyicnc.cloudfront.net`
- **API Gateway (HTTP API v2):** `https://sdz6xbd6l6.execute-api.ap-southeast-1.amazonaws.com`
- **Cognito User Pool:** `ap-southeast-1_fmJ9lD11H`
- **DynamoDB Table:** `polyflash-prod-event-seats`
- **SQS FIFO Queue:** `polyflash-prod-order-queue.fifo`

---

## 3. Kết quả Giả tải (Load Test) Thực tế trên Cloud

Kịch bản giả tải [tests/load-test/flash-sale-bench.mjs](file:///home/ubuntu/dualcore-nosql-sql-ticketing/tests/load-test/flash-sale-bench.mjs) được bắn trực tiếp từ máy client tới các endpoint AWS Production (`CloudFront` và `API Gateway` ở Singapore):

```bash
AUTH_TOKEN="<cognito_id_token>" node tests/load-test/flash-sale-bench.mjs
```

### 3.1. Hiệu năng phân phối Frontend tĩnh (Amazon CloudFront + S3)
| Mức đồng thời (Concurrency) | Tổng Request | Throughput (RPS) | HTTP `200` | p50 Latency | p95 Latency | p99 Latency |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **50** | 300 | **280 req/s** | 300 / 300 (100%) | 86.20 ms | 591.85 ms | 733.68 ms |
| **150** | 600 | **297 req/s** | 600 / 600 (100%) | 95.89 ms | 1,269.44 ms | 1,637.12 ms |

### 3.2. Hiệu năng đọc sơ đồ ghế (`API Gateway -> seat-reader Lambda -> DynamoDB`)
| Mức đồng thời (Concurrency) | Tổng Request | Throughput (RPS) | HTTP `200` | HTTP `503` (Throttled) | p50 Latency | p95 Latency | p99 Latency |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **10** | 100 | **52 req/s** | 100 (100%) | 0 | 91.38 ms | 862.33 ms | 1,195.14 ms |
| **30** | 300 | 299 req/s | 135 | 165 | 69.76 ms | 290.36 ms | 412.17 ms |
| **60** | 300 | 377 req/s | 63 | 237 | 64.76 ms | 508.13 ms | 628.59 ms |

> **Phát hiện nút thắt (Bottleneck) từ bài test thực tế:** Tài khoản AWS hiện tại bị giới hạn **Account Unreserved Lambda Concurrency = 10**. Do đó, ở mức concurrency `10`, hệ thống đạt **100% thành công (`52 RPS`)**; khi đẩy lên `30` hoặc `60` request đồng thời trong tích tắc, các request vượt quá 10 Lambda song song sẽ bị AWS Lambda từ chối (`503 Service Unavailable`).

### 3.3. Kiểm thử tranh chấp Flash Sale (`30 users` đồng thời tranh 1 ghế `A-01` có Cognito JWT thật)
Luồng đầy đủ: `API Gateway (JWT Authorizer) -> seat-locker Lambda -> DynamoDB Conditional Write -> SQS FIFO -> order-processor Lambda -> Neon PostgreSQL`

| Số User đồng thời | Giữ ghế thành công (`202`) | Bị từ chối (`409 Conflict`) | Bị giới hạn Lambda (`503`) | Bán trùng vé (Overselling) | p50 Latency | p99 Latency |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **30** | **1** (`cloud-load-user-19`) | **8** | **21** | **0** | 113.88 ms | 980.74 ms |

**Xác minh dữ liệu End-to-End sau bài test:**
- **Neon PostgreSQL (`orders` & `tickets`):** Ghi nhận đúng 1 đơn hàng `COMPLETED` (`bfdc9763-4ffa-4524-80ea-689d3187fe00`, `user_id = cloud-load-user-19`, `seat_id = A-01`, `1,200,000đ`).
- **Amazon DynamoDB (`polyflash-prod-event-seats`):** Ghế `A-01` tự động đồng bộ sang trạng thái `SOLD` và gỡ bỏ TTL.

```json
// Kết quả truy vấn thực tế từ DynamoDB & Neon PostgreSQL sau bài test Flash Sale
{
  "dynamodb_seat_A01": {
    "PK": "EVENT#11111111-1111-1111-1111-111111111111",
    "SK": "SEAT#A-01",
    "status": "SOLD",
    "held_by": "cloud-load-user-19",
    "price": 1200000
  },
  "neon_postgres_order": {
    "id": "bfdc9763-4ffa-4524-80ea-689d3187fe00",
    "user_id": "cloud-load-user-19",
    "status": "COMPLETED",
    "seat_id": "A-01",
    "total_amount": "1200000.00"
  }
}
```

### 3.4. Bằng chứng Cảnh báo Thời gian thực (CloudWatch Alarm -> SNS -> SSM -> Telegram)
Trong lúc chạy giả tải vượt giới hạn 10 concurrent Lambdas (tổng cộng `165 + 237 + 21 = 423` HTTP `503`), hệ thống giám sát đã tự động kích hoạt cảnh báo `polyflash-prod-api-5xx-errors` với đúng **`423.0` datapoints**, đẩy qua **Amazon SNS**, kích hoạt Lambda `alert-forwarder` (giải mã Token & Chat ID từ **SSM Parameter Store**) và bắn tin nhắn trực tiếp về **Telegram** lúc `13:06` (`06:06:45Z`):

![CloudWatch Alarm Telegram Alert](docs/assets/cloudwatch-telegram-alert.png)

---

## 4. Ước tính Số User Hệ thống Chịu được

Dựa trên hành vi thực tế của Frontend (polling sơ đồ ghế mỗi `2.5s` = `0.4 RPS/user`) và số liệu đo được trên AWS:

### 4.1. Trên cấu hình AWS hiện tại (Account Quota = 10 Concurrent Lambdas)
- **Tải trang tĩnh (CloudFront):** Phục vụ **hàng chục nghìn users** tải giao diện đồng thời (`297+ RPS` từ client đơn, 0% lỗi).
- **Tương tác API đặt vé (`API Gateway + Lambda`):** Với `52 RPS` ổn định không lỗi ở mức 10 Lambda song song, hệ thống chịu được khoảng **~130 concurrent users** đang polling liên tục mỗi `2.5s` (hoặc **~500+ users** duyệt web không polling dồn dập).

### 4.2. Trên Production chuẩn (Sau khi nâng Quota Lambda lên mặc định `1,000` Concurrent Executions)
| Tầng hệ thống | Cấu hình Production | Năng lực xử lý ước tính | Số Concurrent Users ước tính |
| :--- | :--- | :--- | :--- |
| **Frontend (S3 + CloudFront)** | Edge Caching toàn cầu | Không giới hạn thực tế | **> 100,000+ users** |
| **Đọc sơ đồ ghế (`seat-reader` + DynamoDB)** | `1,000` Concurrent Lambdas (~190ms/req cả mạng) | **~5,200 RPS** | **~13,000 users** polling liên tục mỗi `2.5s` |
| **Giữ chỗ (`seat-locker` + SQS FIFO)** | SQS FIFO (`300 TPS` chuẩn / `3,000 TPS` batch) | **300 – 3,000 lượt giữ/giây** | Chống trùng tuyệt đối **0% overselling** |
| **Chốt đơn ACID (`order-processor` + Neon DB)** | `maximum_concurrency = 15`, `batch_size = 10` | **~150 – 300 đơn/giây** | SQS FIFO đệm các đợt burst, không sập SQL |

---

## 5. Triển khai & Kiểm thử

### 5.1. Bundle & Deploy Hạ tầng Terraform
```bash
for svc in seat-reader seat-locker order-processor alert-forwarder; do
  npm run bundle --prefix "services/$svc"
done

cd infra
terraform init
terraform apply
```

### 5.2. Chạy Migration & Unit Mock Tests
```bash
npm run migrate --prefix db
npm run seed --prefix db

npm test --prefix services/seat-reader
npm test --prefix services/seat-locker
npm test --prefix services/order-processor
```
