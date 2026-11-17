locals {
  name_prefix = "${var.project_name}-${var.environment}"
}

module "storage" {
  source                   = "./modules/storage"
  name_prefix              = local.name_prefix
  neon_database_pooled_url = var.neon_database_pooled_url
  neon_database_direct_url = var.neon_database_direct_url
  telegram_bot_token       = var.telegram_bot_token
  telegram_chat_id         = var.telegram_chat_id
}

module "messaging" {
  source      = "./modules/messaging"
  name_prefix = local.name_prefix
}

module "auth" {
  source      = "./modules/auth"
  name_prefix = local.name_prefix
}

module "frontend" {
  source      = "./modules/frontend"
  name_prefix = local.name_prefix
}

module "compute" {
  source                               = "./modules/compute"
  name_prefix                          = local.name_prefix
  dynamodb_table_name                  = module.storage.dynamodb_table_name
  dynamodb_table_arn                   = module.storage.dynamodb_table_arn
  order_queue_url                      = module.messaging.order_queue_url
  order_queue_arn                      = module.messaging.order_queue_arn
  ssm_neon_pooled_url_name             = module.storage.ssm_neon_pooled_url_name
  ssm_neon_pooled_url_arn              = module.storage.ssm_neon_pooled_url_arn
  ssm_telegram_bot_token_name          = module.storage.ssm_telegram_bot_token_name
  ssm_telegram_chat_id_name            = module.storage.ssm_telegram_chat_id_name
  ssm_telegram_arns                    = module.storage.ssm_telegram_arns
  seat_hold_ttl_seconds                = var.seat_hold_ttl_seconds
  order_processor_reserved_concurrency = var.order_processor_reserved_concurrency
  log_retention_days                   = var.log_retention_days
}

module "api" {
  source                 = "./modules/api"
  name_prefix            = local.name_prefix
  user_pool_id           = module.auth.user_pool_id
  user_pool_client_id    = module.auth.client_id
  user_pool_endpoint     = module.auth.user_pool_endpoint
  seat_reader_invoke_arn = module.compute.seat_reader_invoke_arn
  seat_reader_name       = module.compute.seat_reader_name
  seat_locker_invoke_arn = module.compute.seat_locker_invoke_arn
  seat_locker_name       = module.compute.seat_locker_name
  log_retention_days     = var.log_retention_days
}

module "monitoring" {
  source               = "./modules/monitoring"
  name_prefix          = local.name_prefix
  order_queue_name     = module.messaging.order_queue_name
  order_dlq_name       = module.messaging.order_dlq_name
  api_id               = module.api.api_id
  alert_forwarder_arn  = module.compute.alert_forwarder_arn
  alert_forwarder_name = module.compute.alert_forwarder_name
}
