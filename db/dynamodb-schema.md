# DynamoDB Data Modeling — `EventSeats`

Bảng `EventSeats` được thiết kế theo mô hình Single-Table / Composite Key nhằm tối ưu hóa tốc độ đọc danh sách ghế theo sự kiện (<10ms) và khóa ghế nguyên tử (Atomic Conditional Write) trong các đợt Flash Sale.

## 1. Cấu hình Bảng
- **Table Name:** `EventSeats` (hoặc cấu hình qua biến `DYNAMODB_TABLE_SEATS`)
- **Billing Mode:** `PAY_PER_REQUEST` (On-Demand)
- **Time To Live (TTL):** Bật trên thuộc tính `ttl` (Unix epoch timestamp tính bằng giây)

## 2. Cấu trúc Khóa (Primary Key)
| Key | Attribute Name | Format | Ví dụ |
| --- | --- | --- | --- |
| **Partition Key (PK)** | `PK` (String) | `EVENT#<event_id>` | `EVENT#11111111-1111-1111-1111-111111111111` |
| **Sort Key (SK)** | `SK` (String) | `SEAT#<seat_id>` | `SEAT#A-01` |

## 3. Các Thuộc tính (Attributes)
| Attribute | Type | Mô tả |
| --- | --- | --- |
| `status` | String | Trạng thái ghế: `AVAILABLE`, `HELD`, `SOLD` |
| `held_by` | String (Optional) | `user_id` của người đang giữ hoặc đã mua ghế |
| `ttl` | Number (Optional) | Thời điểm hết hạn giữ ghế (Unix timestamp giây). Tự động xóa/nhả sau 5 phút nếu chưa thanh toán |
| `price` | Number | Giá vé của ghế (VNĐ hoặc USD) |
| `updated_at` | String | ISO-8601 timestamp lần cập nhật gần nhất |

## 4. Access Patterns
1. **Lấy toàn bộ sơ đồ ghế của 1 sự kiện (Seat Reader Service):**
   - `Query` với `KeyConditionExpression: PK = :pk` (`EVENT#<event_id>`).
2. **Giữ ghế nguyên tử (Seat Locker Service):**
   - `UpdateItem` trên `(PK, SK)` với `ConditionExpression`:
     `attribute_not_exists(PK) OR #status = :available OR (#status = :held AND #ttl < :now)`
   - Set `status = 'HELD'`, `held_by = :user_id`, `ttl = :now + 300`.
3. **Chốt đơn thành công (Order Processor Worker):**
   - `UpdateItem` trên `(PK, SK)` với `ConditionExpression`: `#status = :held AND held_by = :user_id`
   - Set `status = 'SOLD'`, `REMOVE ttl`.
