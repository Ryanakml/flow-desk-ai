#!/usr/bin/env bash
set -Eeuo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "${script_dir}/health-check.sh"

assert() {
  if ! "$@"; then
    echo "assertion failed: $*" >&2
    exit 1
  fi
}

assert_not() {
  if "$@"; then
    echo "assertion unexpectedly passed: $*" >&2
    exit 1
  fi
}

assert valid_public_base_url "https://staging.example.com"
assert valid_public_base_url "https://staging.example.com/"
assert_not valid_public_base_url ""
assert_not valid_public_base_url "http://staging.example.com"
assert_not valid_public_base_url "https://staging.example.com/path"
assert_not valid_public_base_url "https://user:password@staging.example.com"

health_urls=$(derive_health_urls "https://staging.example.com/")
[[ ${health_urls%%$'\n'*} == "https://staging.example.com/livez" ]]
[[ ${health_urls#*$'\n'} == "https://staging.example.com/api/v1/system/build" ]]
assert_not health_check_passed "308" "200" "expected" "expected"
assert health_check_passed "200" "200" "expected" "expected"
assert_not health_check_passed "200" "200" "expected" "unexpected"
assert is_redirect_status "308"
assert_not is_redirect_status "200"
