output "api_endpoint" {
  description = "HTTP API Gateway endpoint URL"
  value       = module.api.api_endpoint
}

output "cloudfront_url" {
  description = "CloudFront distribution domain for frontend"
  value       = "https://${module.frontend.cloudfront_domain_name}"
}

output "frontend_s3_bucket" {
  description = "S3 bucket storing static frontend assets"
  value       = module.frontend.s3_bucket_name
}

output "dynamodb_seats_table" {
  description = "DynamoDB EventSeats table name"
  value       = module.storage.dynamodb_table_name
}

output "sqs_order_queue_url" {
  description = "SQS FIFO order queue URL"
  value       = module.messaging.order_queue_url
}

output "cognito_user_pool_id" {
  description = "Cognito User Pool ID"
  value       = module.auth.user_pool_id
}

output "cognito_client_id" {
  description = "Cognito Web App Client ID"
  value       = module.auth.client_id
}

output "sns_alerts_topic_arn" {
  description = "SNS Topic ARN for CloudWatch alerts"
  value       = module.monitoring.sns_alerts_topic_arn
}
