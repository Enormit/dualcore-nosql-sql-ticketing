variable "name_prefix" {
  type = string
}

resource "aws_sqs_queue" "order_dlq" {
  name                        = "${var.name_prefix}-order-dlq.fifo"
  fifo_queue                  = true
  content_based_deduplication = true
  message_retention_seconds   = 1209600 # 14 days
  sqs_managed_sse_enabled     = true
}

resource "aws_sqs_queue" "order_queue" {
  name                        = "${var.name_prefix}-order-queue.fifo"
  fifo_queue                  = true
  content_based_deduplication = false
  visibility_timeout_seconds  = 60
  sqs_managed_sse_enabled     = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.order_dlq.arn
    maxReceiveCount     = 3
  })
}

output "order_queue_url" {
  value = aws_sqs_queue.order_queue.url
}

output "order_queue_arn" {
  value = aws_sqs_queue.order_queue.arn
}

output "order_queue_name" {
  value = aws_sqs_queue.order_queue.name
}

output "order_dlq_arn" {
  value = aws_sqs_queue.order_dlq.arn
}

output "order_dlq_name" {
  value = aws_sqs_queue.order_dlq.name
}
