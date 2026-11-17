variable "name_prefix" {
  type = string
}

variable "github_owner" {
  description = "GitHub account / organization owner allowed to assume role"
  type        = string
}

variable "github_repo" {
  description = "Exact GitHub repository name allowed to assume role"
  type        = string
}

variable "deploy_branch" {
  description = "Exact Git branch allowed to run deployments"
  type        = string
  default     = "main"
}

variable "create_oidc_provider" {
  description = "Set to false if GitHub OIDC provider already exists in this AWS account"
  type        = bool
  default     = true
}

variable "frontend_s3_bucket_arn" {
  type = string
}

variable "lambda_function_arns" {
  type = list(string)
}

locals {
  full_repo = "${var.github_owner}/${var.github_repo}"
}

resource "aws_iam_openid_connect_provider" "github" {
  count           = var.create_oidc_provider ? 1 : 0
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1", "1c58a3a8518e8759bf075b76b750d4f2df264fcd"]
}

data "aws_iam_openid_connect_provider" "existing" {
  count = var.create_oidc_provider ? 0 : 1
  url   = "https://token.actions.githubusercontent.com"
}

locals {
  oidc_provider_arn = var.create_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : data.aws_iam_openid_connect_provider.existing[0].arn
}

# ============================================================================
# 1. Deploy Role: Locked strictly to 1 GitHub owner, 1 repo, and branch main
# ============================================================================
data "aws_iam_policy_document" "github_deploy_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:repository_owner"
      values   = [var.github_owner]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:repository"
      values   = [local.full_repo]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${local.full_repo}:environment:production",
        "repo:${local.full_repo}:ref:refs/heads/${var.deploy_branch}",
      ]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name                 = "${var.name_prefix}-github-deploy-role"
  assume_role_policy   = data.aws_iam_policy_document.github_deploy_trust.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy" "github_deploy_permissions" {
  name = "${var.name_prefix}-github-deploy-policy"
  role = aws_iam_role.github_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration", "lambda:GetFunction"]
        Resource = var.lambda_function_arns
      },
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
        Resource = [var.frontend_s3_bucket_arn, "${var.frontend_s3_bucket_arn}/*"]
      },
      {
        Effect   = "Allow"
        Action   = ["cloudfront:CreateInvalidation"]
        Resource = "*"
      }
    ]
  })
}

# Grant PowerUserAccess / IAM management if this role also runs Terraform Apply
resource "aws_iam_role_policy_attachment" "github_deploy_infra" {
  role       = aws_iam_role.github_deploy.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

# ============================================================================
# 2. PR Verification Role: Locked to same owner + repo (pull_request only, ReadOnly)
# ============================================================================
data "aws_iam_policy_document" "github_pr_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:repository_owner"
      values   = [var.github_owner]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:repository"
      values   = [local.full_repo]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${local.full_repo}:pull_request",
        "repo:${local.full_repo}:environment:production",
      ]
    }
  }
}

resource "aws_iam_role" "github_pr_plan" {
  name                 = "${var.name_prefix}-github-pr-plan-role"
  assume_role_policy   = data.aws_iam_policy_document.github_pr_trust.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy_attachment" "github_pr_readonly" {
  role       = aws_iam_role.github_pr_plan.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

output "oidc_provider_arn" {
  value = local.oidc_provider_arn
}

output "github_deploy_role_arn" {
  value = aws_iam_role.github_deploy.arn
}

output "github_pr_plan_role_arn" {
  value = aws_iam_role.github_pr_plan.arn
}
