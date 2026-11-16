variable "name_prefix" {
  type = string
}

variable "user_pool_id" {
  type = string
}

variable "user_pool_client_id" {
  type = string
}

variable "user_pool_endpoint" {
  type = string
}

variable "seat_reader_invoke_arn" {
  type = string
}

variable "seat_reader_name" {
  type = string
}

variable "seat_locker_invoke_arn" {
  type = string
}

variable "seat_locker_name" {
  type = string
}

variable "log_retention_days" {
  type = number
}

resource "aws_apigatewayv2_api" "this" {
  name          = "${var.name_prefix}-http-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "PUT", "PATCH", "OPTIONS"]
    allow_headers = ["Authorization", "Content-Type"]
    max_age       = 300
  }
}

resource "aws_cloudwatch_log_group" "api_logs" {
  name              = "/aws/apigateway/${var.name_prefix}-http-api"
  retention_in_days = var.log_retention_days
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_logs.arn
    format = jsonencode({
      requestId    = "$context.requestId"
      ip           = "$context.identity.sourceIp"
      httpMethod   = "$context.httpMethod"
      routeKey     = "$context.routeKey"
      status       = "$context.status"
      responseTime = "$context.responseLatency"
    })
  }
}

resource "aws_apigatewayv2_authorizer" "cognito_jwt" {
  api_id           = aws_apigatewayv2_api.this.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "${var.name_prefix}-cognito-jwt"

  jwt_configuration {
    audience = [var.user_pool_client_id]
    issuer   = "https://${var.user_pool_endpoint}"
  }
}

resource "aws_apigatewayv2_integration" "seat_reader" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = var.seat_reader_invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "seat_locker" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = var.seat_locker_invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "get_seats" {
  api_id    = aws_apigatewayv2_api.this.id
  route_key = "GET /api/v1/events/{eventId}/seats"
  target    = "integrations/${aws_apigatewayv2_integration.seat_reader.id}"
}

resource "aws_apigatewayv2_route" "hold_seat" {
  api_id             = aws_apigatewayv2_api.this.id
  route_key          = "POST /api/v1/events/{eventId}/seats/{seatId}/hold"
  target             = "integrations/${aws_apigatewayv2_integration.seat_locker.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito_jwt.id
}

resource "aws_lambda_permission" "allow_apigw_reader" {
  statement_id  = "AllowAPIGatewayInvokeReader"
  action        = "lambda:InvokeFunction"
  function_name = var.seat_reader_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*"
}

resource "aws_lambda_permission" "allow_apigw_locker" {
  statement_id  = "AllowAPIGatewayInvokeLocker"
  action        = "lambda:InvokeFunction"
  function_name = var.seat_locker_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*"
}

output "api_id" {
  value = aws_apigatewayv2_api.this.id
}

output "api_endpoint" {
  value = aws_apigatewayv2_api.this.api_endpoint
}
