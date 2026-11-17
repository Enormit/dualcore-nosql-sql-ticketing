variable "name_prefix" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "dynamodb_table_name" {
  type = string
}

variable "order_queue_name" {
  type = string
}

variable "order_dlq_name" {
  type = string
}

variable "api_id" {
  type = string
}

variable "seat_reader_name" {
  type = string
}

variable "seat_locker_name" {
  type = string
}

variable "order_processor_name" {
  type = string
}

variable "alert_forwarder_arn" {
  type = string
}

variable "alert_forwarder_name" {
  type = string
}

resource "aws_sns_topic" "alerts" {
  name = "${var.name_prefix}-alerts-topic"
}

resource "aws_sns_topic_subscription" "alert_lambda" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "lambda"
  endpoint  = var.alert_forwarder_arn
}

resource "aws_lambda_permission" "allow_sns" {
  statement_id  = "AllowSNSInvokeAlertForwarder"
  action        = "lambda:InvokeFunction"
  function_name = var.alert_forwarder_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.alerts.arn
}

# 1. Alarm: Any message in SQS Dead-Letter Queue (DLQ >= 1)
resource "aws_cloudwatch_metric_alarm" "dlq_not_empty" {
  alarm_name          = "${var.name_prefix}-dlq-not-empty"
  alarm_description   = "Critical: Failed order message landed in DLQ"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Maximum"
  threshold           = 1
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    QueueName = var.order_dlq_name
  }
}

# 2. Alarm: Oldest message in SQS FIFO > 30s (Worker lag or Neon Cold Start)
resource "aws_cloudwatch_metric_alarm" "sqs_oldest_message_age" {
  alarm_name          = "${var.name_prefix}-sqs-queue-lag"
  alarm_description   = "Warning: Oldest message in order queue > 30s"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateAgeOfOldestMessage"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Maximum"
  threshold           = 30
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    QueueName = var.order_queue_name
  }
}

# 3. Alarm: API Gateway 5XX errors
resource "aws_cloudwatch_metric_alarm" "api_5xx_errors" {
  alarm_name          = "${var.name_prefix}-api-5xx-errors"
  alarm_description   = "Critical: API Gateway returning 5XX errors"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "5xx"
  namespace           = "AWS/ApiGateway"
  period              = 60
  statistic           = "Sum"
  threshold           = 1
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    ApiId = var.api_id
  }
}

# 4. Alarm: API Gateway p99 Latency > 2000ms
resource "aws_cloudwatch_metric_alarm" "api_p99_latency" {
  alarm_name          = "${var.name_prefix}-api-p99-latency"
  alarm_description   = "Warning: API Gateway p99 latency > 2000ms"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "Latency"
  namespace           = "AWS/ApiGateway"
  period              = 60
  extended_statistic  = "p99"
  threshold           = 2000
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    ApiId = var.api_id
  }
}

# 5. AWS X-Ray Sampling Rule: 5% baseline for cost optimization
resource "aws_xray_sampling_rule" "baseline" {
  rule_name      = "${var.name_prefix}-5pct"
  priority       = 100
  version        = 1
  reservoir_size = 1
  fixed_rate     = 0.05
  url_path       = "*"
  host           = "*"
  http_method    = "*"
  service_type   = "*"
  service_name   = "*"
  resource_arn   = "*"
}

# 6. CloudWatch Unified Operations Dashboard
resource "aws_cloudwatch_dashboard" "polyflash" {
  dashboard_name = "${var.name_prefix}-observability"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "alarm"
        x      = 0
        y      = 0
        width  = 24
        height = 3
        properties = {
          title = "PolyFlash Critical Alarms Status"
          alarms = [
            aws_cloudwatch_metric_alarm.dlq_not_empty.arn,
            aws_cloudwatch_metric_alarm.sqs_oldest_message_age.arn,
            aws_cloudwatch_metric_alarm.api_5xx_errors.arn,
            aws_cloudwatch_metric_alarm.api_p99_latency.arn,
          ]
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 3
        width  = 12
        height = 6
        properties = {
          title  = "API Gateway - Traffic & Errors (4XX / 5XX)"
          region = var.aws_region
          stat   = "Sum"
          period = 60
          metrics = [
            ["AWS/ApiGateway", "Count", "ApiId", var.api_id, { label = "Total Requests" }],
            [".", "4xx", ".", ".", { label = "4XX (Incl. 409 Conflicts)", color = "#f59e0b" }],
            [".", "5xx", ".", ".", { label = "5XX (Throttles / Errors)", color = "#ef4444" }],
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 3
        width  = 12
        height = 6
        properties = {
          title  = "API Gateway - Latency (p50 / p95 / p99 ms)"
          region = var.aws_region
          period = 60
          metrics = [
            ["AWS/ApiGateway", "Latency", "ApiId", var.api_id, { stat = "p50", label = "p50" }],
            ["...", { stat = "p95", label = "p95" }],
            ["...", { stat = "p99", label = "p99", color = "#ef4444" }],
          ]
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 9
        width  = 12
        height = 6
        properties = {
          title  = "Lambda Invocations, Errors & Throttles"
          region = var.aws_region
          stat   = "Sum"
          period = 60
          metrics = [
            ["AWS/Lambda", "Invocations", "FunctionName", var.seat_reader_name, { label = "seat-reader Invocations" }],
            [".", "Invocations", ".", var.seat_locker_name, { label = "seat-locker Invocations" }],
            [".", "Invocations", ".", var.order_processor_name, { label = "order-processor Invocations" }],
            [".", "Throttles", ".", var.seat_reader_name, { label = "seat-reader Throttles", color = "#ef4444" }],
            [".", "Throttles", ".", var.seat_locker_name, { label = "seat-locker Throttles", color = "#dc2626" }],
            [".", "Errors", ".", var.order_processor_name, { label = "order-processor Errors", color = "#991b1b" }],
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 9
        width  = 12
        height = 6
        properties = {
          title  = "Lambda Duration (p95 ms)"
          region = var.aws_region
          stat   = "p95"
          period = 60
          metrics = [
            ["AWS/Lambda", "Duration", "FunctionName", var.seat_reader_name, { label = "seat-reader" }],
            [".", "Duration", ".", var.seat_locker_name, { label = "seat-locker" }],
            [".", "Duration", ".", var.order_processor_name, { label = "order-processor" }],
            [".", "Duration", ".", var.alert_forwarder_name, { label = "alert-forwarder" }],
          ]
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 15
        width  = 12
        height = 6
        properties = {
          title  = "SQS FIFO Queue & DLQ Health"
          region = var.aws_region
          period = 60
          metrics = [
            ["AWS/SQS", "NumberOfMessagesSent", "QueueName", var.order_queue_name, { stat = "Sum", label = "Orders Queued" }],
            [".", "ApproximateNumberOfMessagesVisible", ".", var.order_queue_name, { stat = "Maximum", label = "Queue Backlog" }],
            [".", "ApproximateAgeOfOldestMessage", ".", var.order_queue_name, { stat = "Maximum", label = "Oldest Msg Age (s)" }],
            [".", "ApproximateNumberOfMessagesVisible", ".", var.order_dlq_name, { stat = "Maximum", label = "DLQ Messages", color = "#ef4444" }],
          ]
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 15
        width  = 12
        height = 6
        properties = {
          title  = "DynamoDB EventSeats - Capacity & Flash Sale Conflicts"
          region = var.aws_region
          stat   = "Sum"
          period = 60
          metrics = [
            ["AWS/DynamoDB", "ConsumedReadCapacityUnits", "TableName", var.dynamodb_table_name, { label = "Read Capacity Units" }],
            [".", "ConsumedWriteCapacityUnits", ".", ".", { label = "Write Capacity Units" }],
            [".", "ConditionalCheckFailedRequests", ".", ".", { label = "Atomic Lock Conflicts Blocked", color = "#f59e0b" }],
          ]
        }
      },
    ]
  })
}

output "sns_alerts_topic_arn" {
  value = aws_sns_topic.alerts.arn
}

output "cloudwatch_dashboard_name" {
  value = aws_cloudwatch_dashboard.polyflash.dashboard_name
}

