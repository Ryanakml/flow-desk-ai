terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  type    = string
  default = "ap-southeast-1"
}

variable "environment" {
  type    = string
  default = "production"
}

variable "vpc_id" {
  type    = string
  default = "vpc-0123456789abcdef0"
}

variable "enable_canary_routing" {
  type    = bool
  default = true
}

variable "canary_weight" {
  type        = number
  default     = 5
  description = "Percentage of production traffic routed to canary slice (0, 5, 25, 100)"
  validation {
    condition     = contains([0, 5, 25, 100], var.canary_weight)
    error_message = "canary_weight must be 0, 5, 25, or 100."
  }
}

locals {
  name_prefix   = "flowdesk-${var.environment}"
  stable_weight = 100 - var.canary_weight
}

# Production Target Groups for Weighted Canary Routing
resource "aws_lb_target_group" "production_stable" {
  name        = "${local.name_prefix}-stable-tg"
  port        = 4000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    path                = "/livez"
    port                = "4000"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = {
    Environment = var.environment
    Slice       = "stable"
    ManagedBy   = "terraform"
  }
}

resource "aws_lb_target_group" "production_canary" {
  name        = "${local.name_prefix}-canary-tg"
  port        = 4000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    path                = "/livez"
    port                = "4000"
    matcher             = "200"
    interval            = 10
    timeout             = 3
    healthy_threshold   = 2
    unhealthy_threshold = 2
  }

  tags = {
    Environment = var.environment
    Slice       = "canary"
    ManagedBy   = "terraform"
  }
}

# GitHub Actions OIDC Short-Lived Role for Production Promotion
resource "aws_iam_role" "github_actions_production_oidc" {
  name = "${local.name_prefix}-github-actions-oidc"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          }
          StringLike = {
            "token.actions.githubusercontent.com:sub" = "repo:Ryanakml/flowdesk-ai:environment:production"
          }
        }
      }
    ]
  })

  tags = {
    Environment = var.environment
    Purpose     = "github-actions-oidc-promotion"
    ManagedBy   = "terraform"
  }
}

# Automated Rollback Alarm on Canary Error Rate Spike
resource "aws_cloudwatch_metric_alarm" "canary_error_rate_rollback" {
  alarm_name          = "${local.name_prefix}-canary-error-rate-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Sum"
  threshold           = 5
  alarm_description   = "Triggers immediate canary rollback if 5xx errors exceed 5 in 1 minute"

  dimensions = {
    TargetGroup = aws_lb_target_group.production_canary.arn_suffix
  }

  tags = {
    Environment = var.environment
    Slice       = "canary"
    ManagedBy   = "terraform"
  }
}

output "environment" {
  value = var.environment
}

output "canary_routing_enabled" {
  value = var.enable_canary_routing
}

output "canary_weight" {
  value = var.canary_weight
}

output "stable_target_group_arn" {
  value = aws_lb_target_group.production_stable.arn
}

output "canary_target_group_arn" {
  value = aws_lb_target_group.production_canary.arn
}

output "oidc_role_arn" {
  value = aws_iam_role.github_actions_production_oidc.arn
}
