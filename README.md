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
├── scripts/                # Local dev server mô phỏng API Gateway & luồng đặt vé
├── services/               # 4 AWS Lambda microservices (seat-reader, seat-locker, order-processor, alert-forwarder)
└── tests/load-test/        # Kịch bản giả tải & kiểm thử tranh chấp Flash Sale
```

---

## 2. Hướng dẫn Chạy Local & Kiểm thử

### 2.1. Chạy ứng dụng Web trên Localhost
```bash
node scripts/local-server.mjs
# Truy cập: http://localhost:3000
```

### 2.2. Chạy Unit Mock Tests cho Microservices
```bash
npm test --prefix services/seat-reader
npm test --prefix services/seat-locker
npm test --prefix services/order-processor
```

### 2.3. Chạy Giả tải (Load Test)
```bash
node tests/load-test/flash-sale-bench.mjs
```

---

## 3. Kết quả Giả tải (Load Test) & Ước tính Sức chịu tải

### 3.1. Kết quả đo thực tế trên Local Dev Server (`http://localhost:3000`)
Kịch bản thực thi bằng [tests/load-test/flash-sale-bench.mjs](file:///home/ubuntu/dualcore-nosql-sql-ticketing/tests/load-test/flash-sale-bench.mjs) (mô phỏng in-memory trên 1 tiến trình Node.js đơn):

#### A. Hiệu năng đọc sơ đồ ghế (`GET /api/v1/events/{id}/seats`)
| Mức đồng thời (Concurrency) | Tổng Request | Throughput (RPS) | p50 Latency | p95 Latency | p99 Latency | Lỗi |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **50** | 1,000 | **1,149 req/s** | 30.76 ms | 80.68 ms | 99.77 ms | 0% |
| **200** | 2,000 | **2,003 req/s** | 90.06 ms | 185.17 ms | 226.12 ms | 0% |
| **500** | 3,000 | **3,148 req/s** | 133.95 ms | 289.14 ms | 355.94 ms | 0% |

#### B. Kiểm thử tranh chấp Flash Sale (`200 users` cùng bấm giữ 1 ghế `A-02`)
| Số User đồng thời | Thời gian hoàn tất | Giữ ghế thành công (`202`) | Bị từ chối (`409 Conflict`) | Lỗi 5XX / Overselling | p95 Latency | p99 Latency |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **200** | 120 ms | **1** | **199** | **0** | 98.10 ms | 98.39 ms |

#### C. Lưu lượng hỗn hợp thực tế (`80%` duyệt sự kiện/xem ghế + `20%` giữ/nhả ghế trong 5 giây)
| Mức đồng thời (Concurrency) | Tổng Request (5s) | Throughput (RPS) | p50 Latency | p95 Latency | p99 Latency | Lỗi |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **100** | 15,923 | **3,174 req/s** | 26.62 ms | 54.57 ms | 74.81 ms | 0% |
| **300** | 17,521 | **3,486 req/s** | 75.97 ms | 131.16 ms | 163.80 ms | 0% |

---

### 3.2. Ước tính số User hệ thống có thể chịu được

#### 1) Trên môi trường Local (1 tiến trình Node.js đơn + Mock in-memory)
- Theo thiết kế frontend, mỗi người dùng mở trang sơ đồ ghế thực hiện polling mỗi `2.5s` (**0.4 RPS/user**), kết hợp thao tác duyệt trang và giữ ghế trung bình khoảng **0.5 – 1.0 RPS/user** ở thời điểm cao điểm.
- Với ngưỡng đo ổn định **~3,486 RPS** tại `p99 = 163.80 ms` (`0%` lỗi):
  - **Số lượng Concurrent Active Users ước tính:** **~3,500 – 8,000 users** hoạt động đồng thời (lưu ý: môi trường local dùng dữ liệu in-memory nên không có độ trễ mạng tới DB thật).

#### 2) Trên hạ tầng Cloud Production (AWS `ap-southeast-1` + Neon DB theo `infra/`)
Dựa trên giới hạn của từng tầng dịch vụ đã khai báo trong Terraform:

| Tầng hệ thống | Dịch vụ / Cấu hình (`infra/`) | Giới hạn kỹ thuật | Sức chịu tải ước tính |
| :--- | :--- | :--- | :--- |
| **Frontend & CDN** | Amazon S3 + CloudFront | Phân phối edge toàn cầu | **> 100,000+ users** tải trang tĩnh |
| **Đọc sơ đồ ghế** | API Gateway + `seat-reader` + DynamoDB On-Demand | Lambda concurrency mặc định `1,000`, độ trễ DynamoDB ~10–30 ms | **~30,000+ RPS** (~**50,000 – 75,000 users** polling mỗi 2.5s) |
| **Giữ chỗ Flash Sale** | `seat-locker` + Amazon SQS FIFO | SQS FIFO hỗ trợ **300 TPS** (tiêu chuẩn) hoặc **3,000 TPS** (high-throughput mode) | **300 – 3,000 lượt giữ ghế/giây** |
| **Chốt đơn ACID** | `order-processor` (`reserved_concurrency = 15`, `batch_size = 10`) + Neon PgBouncer | Giới hạn 15 worker song song để bảo vệ pool kết nối Neon DB | **~150 – 300 đơn hàng/giây** (phần tăng đột biến được SQS FIFO đệm lại, không rơi đơn) |

> **Kết luận:** Với kiến trúc hiện tại, hệ thống có thể phục vụ khoảng **50,000+ người dùng xem sự kiện/ghế đồng thời**, tiếp nhận **300 – 3,000 yêu cầu giữ chỗ/giây** qua SQS FIFO và xử lý chốt đơn ACID bền vững vào Neon PostgreSQL với **0% bán trùng vé**.

---

## 4. Triển khai Hạ tầng (Terraform)

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars
# Điền NEON_DATABASE_POOLED_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID...
terraform init
terraform plan
terraform apply
```
