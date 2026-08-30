#!/usr/bin/env bash

valid_public_base_url() {
  [[ ${1:-} =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?/?$ ]]
}

derive_health_urls() {
  local public_base_url=${1%/}
  printf '%s\n%s\n' \
    "${public_base_url}/livez" \
    "${public_base_url}/api/v1/system/build"
}

health_check_passed() {
  [[ ${1:-} == "200" && ${2:-} == "200" && ${3:-} == "${4:-}" ]]
}

is_redirect_status() {
  [[ ${1:-} =~ ^30[12378]$ ]]
}
