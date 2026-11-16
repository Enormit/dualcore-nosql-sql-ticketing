variable "name_prefix" {
  type = string
}

variable "dynamodb_table_name" {
  type = string
}

variable "dynamodb_table_arn" {
  type = string
}

variable "order_queue_url" {
  type = string
}

variable "order_queue_arn" {
  type = string
}

variable "neon_database_pooled_url" {
  type      = string
  sensitive = true
}

variable "telegram_bot_token" {
  type      = string
  sensitive = true
}

variable "telegram_chat_id" {
  type = string
}

variable "seat_hold_ttl_seconds" {
  type = number
}

variable "order_processor_reserved_concurrency" {
  type = number
}

variable "log_retention_days" {
  type = number
}

locals {
  services = {
    seat-reader     = "${path.root}/../services/seat-reader/src"
    seat-locker     = "${path.root}/../services/seat-locker/src"
    order-processor = "${path.root}/../services/order-processor/src"
    alert-forwarder = "${path.root}/../services/alert-forwarder/src"
  }
}

data "archive_file" "lambda_zips" {
  for_each    = local.services
  type        = "zip"
  source_dir  = each.value
  output_path = "${path.root}/.terraform/zips/${each.key}.zip"
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda_roles" {
  for_each           = local.services
  name               = "${var.name_prefix}-${each.key}-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "basic_logs" {
  for_each   = local.services
  role       = aws_iam_role.lambda_roles[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "xray" {
  for_each   = local.services
  role       = aws_iam_role.lambda_roles[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
}

# Least-privilege policy: seat-reader (DynamoDB Query)
resource "aws_iam_role_policy" "seat_reader_policy" {
  name = "${var.name_prefix}-seat-reader-ddb"
  role = aws_iam_role.lambda_roles["seat-reader"].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["dynamodb:Query", "dynamodb:GetItem"]
      Resource = var.dynamodb_table_arn
    }]
  })
}

# Least-privilege policy: seat-locker (DynamoDB Update + SQS SendMessage)
resource "aws_iam_role_policy" "seat_locker_policy" {
  name = "${var.name_prefix}-seat-locker-ddb-sqs"
  role = aws_iam_role.lambda_roles["seat-locker"].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:UpdateItem", "dynamodb:GetItem"]
        Resource = var.dynamodb_table_arn
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = var.order_queue_arn
      }
    ]
  })
}

# Least-privilege policy: order-processor (SQS Consume + DynamoDB Update)
resource "aws_iam_role_policy" "order_processor_policy" {
  name = "${var.name_prefix}-order-processor-sqs-ddb"
  role = aws_iam_role.lambda_roles["order-processor"].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Resource = var.order_queue_arn
      },
      {
        Effect   = "Allow"
        Action   = ["dynamodb:UpdateItem"]
        Resource = var.dynamodb_table_arn
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "lambda_logs" {
  for_each          = local.services
  name              = "/aws/lambda/${var.name_prefix}-${each.key}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "seat_reader" {
  function_name    = "${var.name_prefix}-seat-reader"
  role             = aws_iam_role.lambda_roles["seat-reader"].arn
  runtime          = "nodejs22.x"
  handler          = "index.handler"
  filename         = data.archive_file.lambda_zips["seat-reader"].output_path
  source_code_hash = data.archive_file.lambda_zips["seat-reader"].output_base64sha256
  timeout          = 10
  memory_size      = 256

  tracing_config {
    mode = "Active"
  }

  environment {
    variables = {
      DYNAMODB_TABLE_SEATS = var.dynamodb_table_name
    }
  }

  depends_on = [aws_cloudwatch_log_group.lambda_logs["seat-reader"]]
}

resource "aws_lambda_function" "seat_locker" {
  function_name    = "${var.name_prefix}-seat-locker"
  role             = aws_iam_role.lambda_roles["seat-locker"].arn
  runtime          = "nodejs22.x"
  handler          = "index.handler"
  filename         = data.archive_file.lambda_zips["seat-locker"].output_path
  source_code_hash = data.archive_file.lambda_zips["seat-locker"].output_base64sha256
  timeout          = 10
  memory_size      = 256

  tracing_config {
    mode = "Active"
  }

  environment {
    variables = {
      DYNAMODB_TABLE_SEATS  = var.dynamodb_table_name
      SQS_ORDER_QUEUE_URL   = var.order_queue_url
      SEAT_HOLD_TTL_SECONDS = tostring(var.seat_hold_ttl_seconds)
    }
  }

  depends_on = [aws_cloudwatch_log_group.lambda_logs["seat-locker"]]
}

resource "aws_lambda_function" "order_processor" {
  function_name                  = "${var.name_prefix}-order-processor"
  role                           = aws_iam_role.lambda_roles["order-processor"].arn
  runtime                        = "nodejs22.x"
  handler                        = "index.handler"
  filename                       = data.archive_file.lambda_zips["order-processor"].output_path
  source_code_hash               = data.archive_file.lambda_zips["order-processor"].output_base64sha256
  timeout                        = 30
  memory_size                    = 512
  reserved_concurrent_executions = var.order_processor_reserved_concurrency

  tracing_config {
    mode = "Active"
  }

  environment {
    variables = {
      DYNAMODB_TABLE_SEATS     = var.dynamodb_table_name
      NEON_DATABASE_POOLED_URL = var.neon_database_pooled_url
    }
  }

  depends_on = [aws_cloudwatch_log_group.lambda_logs["order-processor"]]
}

resource "aws_lambda_event_source_mapping" "sqs_to_order_processor" {
  event_source_arn        = var.order_queue_arn
  function_name           = aws_lambda_function.order_processor.arn
  batch_size              = 10
  function_response_types = ["ReportBatchItemFailures"]
}

resource "aws_lambda_function" "alert_forwarder" {
  function_name    = "${var.name_prefix}-alert-forwarder"
  role             = aws_iam_role.lambda_roles["alert-forwarder"].arn
  runtime          = "nodejs22.x"
  handler          = "index.handler"
  filename         = data.archive_file.lambda_zips["alert-forwarder"].output_path
  source_code_hash = data.archive_file.lambda_zips["alert-forwarder"].output_base64sha256
  timeout          = 10
  memory_size      = 128

  environment {
    variables = {
      TELEGRAM_BOT_TOKEN = var.telegram_bot_token
      TELEGRAM_CHAT_ID   = var.telegram_chat_id
    }
  }

  depends_on = [aws_cloudwatch_log_group.lambda_logs["alert-forwarder"]]
}

output "seat_reader_arn" {
  value = aws_lambda_function.seat_reader.arn
}

output "seat_reader_invoke_arn" {
  value = aws_lambda_function.seat_reader.invoke_arn
}

output "seat_reader_name" {
  value = aws_lambda_function.seat_reader.function_name
}

output "seat_locker_arn" {
  value = aws_lambda_function.seat_locker.arn
}

output "seat_locker_invoke_arn" {
  value = aws_lambda_function.seat_locker.invoke_arn
}

output "seat_locker_name" {
  value = aws_lambda_function.seat_locker.function_name
}

output "order_processor_name" {
  value = aws_lambda_function.order_processor.function_name
}

output "alert_forwarder_arn" {
  value = aws_lambda_function.alert_forwarder.arn
}

output "alert_forwarder_name" {
  value = aws_lambda_function.alert_forwarder.function_name
}
