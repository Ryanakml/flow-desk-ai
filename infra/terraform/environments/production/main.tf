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

variable "enable_canary_routing" {
  type    = bool
  default = true
}

output "environment" {
  value = var.environment
}

output "canary_routing_enabled" {
  value = var.enable_canary_routing
}
