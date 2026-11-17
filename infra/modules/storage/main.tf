variable "name_prefix" {
  type = string
}

variable "neon_database_pooled_url" {
  type      = string
  sensitive = true
}

variable "neon_database_direct_url" {
  type      = string
  sensitive = true
  default   = ""
}

variable "telegram_bot_token" {
  type      = string
  sensitive = true
  default   = ""
}

variable "telegram_chat_id" {
  type      = string
  sensitive = true
  default   = ""
}

resource "aws_dynamodb_table" "event_seats" {
  name         = "${var.name_prefix}-event-seats"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }
}

# ============================================================================
# AWS Systems Manager (SSM) Parameter Store - SecureString Secrets
# ============================================================================

resource "aws_ssm_parameter" "neon_pooled_url" {
  name        = "/${var.name_prefix}/neon-database-pooled-url"
  description = "Neon PostgreSQL Pooled URL (PgBouncer) for Order Processor"
  type        = "SecureString"
  value       = var.neon_database_pooled_url
}

resource "aws_ssm_parameter" "neon_direct_url" {
  count       = var.neon_database_direct_url != "" ? 1 : 0
  name        = "/${var.name_prefix}/neon-database-direct-url"
  description = "Neon PostgreSQL Direct URL for schema migrations"
  type        = "SecureString"
  value       = var.neon_database_direct_url
}

resource "aws_ssm_parameter" "telegram_bot_token" {
  count       = var.telegram_bot_token != "" ? 1 : 0
  name        = "/${var.name_prefix}/telegram-bot-token"
  description = "Telegram Bot Token for ChatOps alerts"
  type        = "SecureString"
  value       = var.telegram_bot_token
}

resource "aws_ssm_parameter" "telegram_chat_id" {
  count       = var.telegram_chat_id != "" ? 1 : 0
  name        = "/${var.name_prefix}/telegram-chat-id"
  description = "Telegram Chat ID for ChatOps alerts"
  type        = "SecureString"
  value       = var.telegram_chat_id
}

output "dynamodb_table_name" {
  value = aws_dynamodb_table.event_seats.name
}

output "dynamodb_table_arn" {
  value = aws_dynamodb_table.event_seats.arn
}

output "ssm_neon_pooled_url_name" {
  value = aws_ssm_parameter.neon_pooled_url.name
}

output "ssm_neon_pooled_url_arn" {
  value = aws_ssm_parameter.neon_pooled_url.arn
}

output "ssm_telegram_bot_token_name" {
  value = "/${var.name_prefix}/telegram-bot-token"
}

output "ssm_telegram_chat_id_name" {
  value = "/${var.name_prefix}/telegram-chat-id"
}

output "ssm_telegram_arns" {
  value = compact([
    try(aws_ssm_parameter.telegram_bot_token[0].arn, ""),
    try(aws_ssm_parameter.telegram_chat_id[0].arn, ""),
  ])
}
