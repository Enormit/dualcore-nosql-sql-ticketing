variable "name_prefix" {
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

output "sns_alerts_topic_arn" {
  value = aws_sns_topic.alerts.arn
}
