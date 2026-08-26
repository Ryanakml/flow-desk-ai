variable "project_name" {
  description = "Stable project identifier used for resource naming."
  type        = string
  default     = "flowdesk"
}

variable "environment" {
  description = "Isolated deployment environment."
  type        = string
  validation {
    condition     = contains(["preview", "staging", "production"], var.environment)
    error_message = "environment must be preview, staging, or production."
  }
}

