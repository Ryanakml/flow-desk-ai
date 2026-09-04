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

data "aws_caller_identity" "current" {}

variable "aws_region" {
  type    = string
  default = "ap-southeast-1"
}

variable "environment" {
  type    = string
  default = "production"
}

variable "vpc_id" {
  type        = string
  default     = ""
  description = "VPC ID where the production ALB and Target Groups are deployed"
}

variable "subnet_ids" {
  type        = list(string)
  default     = []
  description = "Public subnet IDs for the Application Load Balancer"
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

# Production ALB Security Group
resource "aws_security_group" "production_alb" {
  name        = "${local.name_prefix}-alb-sg"
  description = "Security group for production Application Load Balancer"
  vpc_id      = var.vpc_id != "" ? var.vpc_id : null

  ingress {
    description = "HTTP ingress"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS ingress"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "Allow all outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# Production Application Load Balancer
resource "aws_lb" "production" {
  name               = "${local.name_prefix}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.production_alb.id]
  subnets            = var.subnet_ids

  enable_deletion_protection = true

  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# Production Target Groups for Weighted Canary Routing
resource "aws_lb_target_group" "production_stable" {
  name        = "${local.name_prefix}-stable-tg"
  port        = 4000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id != "" ? var.vpc_id : null
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
  vpc_id      = var.vpc_id != "" ? var.vpc_id : null
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

# Production ALB Listener with Weighted Canary Traffic Distribution
resource "aws_lb_listener" "production_http" {
  load_balancer_arn = aws_lb.production.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "forward"

    forward {
      target_group {
        arn    = aws_lb_target_group.production_stable.arn
        weight = local.stable_weight
      }

      target_group {
        arn    = aws_lb_target_group.production_canary.arn
        weight = var.canary_weight
      }

      stickiness {
        enabled  = false
        duration = 1
      }
    }
  }

  tags = {
    Environment = var.environment
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
          Federated = "arn:aws:iam://${data.aws_caller_identity.current.account_id}:oidc-provider/token.actions.githubusercontent.com"
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

# Policy allowing GitHub Actions to modify listener weights and query CloudWatch alarms
resource "aws_iam_policy" "github_actions_canary_traffic" {
  name        = "${local.name_prefix}-canary-traffic-policy"
  description = "Allows GitHub Actions production workflow to adjust canary traffic weights on the ALB listener"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "elasticloadbalancing:ModifyListener",
          "elasticloadbalancing:ModifyRule",
          "elasticloadbalancing:DescribeListeners",
          "elasticloadbalancing:DescribeRules",
          "elasticloadbalancing:DescribeTargetGroups",
          "elasticloadbalancing:DescribeTargetHealth"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "cloudwatch:GetMetricData",
          "cloudwatch:DescribeAlarms"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "github_actions_canary_traffic" {
  role       = aws_iam_role.github_actions_production_oidc.name
  policy_arn = aws_iam_policy.github_actions_canary_traffic.arn
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

output "alb_arn" {
  value = aws_lb.production.arn
}

output "alb_dns_name" {
  value = aws_lb.production.dns_name
}

output "listener_arn" {
  value = aws_lb_listener.production_http.arn
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
