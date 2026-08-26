output "foundation" {
  description = "Validated foundation metadata; cloud resources start in M3."
  value = {
    name_prefix = local.name_prefix
    tags        = local.common_tags
  }
}

