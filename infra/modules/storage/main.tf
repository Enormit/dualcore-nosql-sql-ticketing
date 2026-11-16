variable "name_prefix" {
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

resource "aws_ssm_parameter" "neon_pooled_url" {
  name  = "/${var.name_prefix}/neon-database-pooled-url"
  type  = "SecureString"
  value = var.neon_database_pooled_url
}

resource "aws_ssm_parameter" "telegram_bot_token" {
  count = var.telegram_bot_token != "" ? 1 : 0
  name  = "/${var.name_prefix}/telegram-bot-token"
  type  = "SecureString"
  value = var.telegram_bot_token
}

output "dynamodb_table_name" {
  value = aws_dynamodb_table.event_seats.name
}

output "dynamodb_table_arn" {
  value = aws_dynamodb_table.event_seats.arn
}

output "ssm_neon_pooled_url_arn" {
  value = aws_ssm_parameter.neon_pooled_url.arn
}
