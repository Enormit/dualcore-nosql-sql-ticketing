variable "aws_region" {
  description = "AWS region to deploy infrastructure"
  type        = string
  default     = "ap-southeast-1"
}

variable "project_name" {
  description = "Project prefix for resource naming"
  type        = string
  default     = "polyflash"
}

variable "environment" {
  description = "Deployment environment (dev, staging, prod)"
  type        = string
  default     = "prod"
}

variable "neon_database_pooled_url" {
  description = "Neon PostgreSQL Pooled URL (PgBouncer) stored in SSM SecureString"
  type        = string
  sensitive   = true
}

variable "neon_database_direct_url" {
  description = "Neon PostgreSQL Direct URL for SQL migrations stored in SSM SecureString"
  type        = string
  sensitive   = true
  default     = ""
}

variable "telegram_bot_token" {
  description = "Telegram Bot Token for ChatOps alert forwarder"
  type        = string
  sensitive   = true
  default     = ""
}

variable "telegram_chat_id" {
  description = "Telegram Chat ID for ChatOps notifications"
  type        = string
  default     = ""
}

variable "seat_hold_ttl_seconds" {
  description = "Seat hold TTL duration in seconds"
  type        = number
  default     = 300
}

variable "order_processor_reserved_concurrency" {
  description = "Max concurrent executions for Order Processor to protect Neon DB connections"
  type        = number
  default     = 15
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention in days (7-14 days for Free Tier)"
  type        = number
  default     = 14
}
