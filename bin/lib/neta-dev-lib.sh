#!/usr/bin/env bash
#
# Shared library for neta-dev-app CLI toolkit.
# Source this file, do not execute directly.
#

set -euo pipefail

# ---------------------------------------------------------------------------
# dependencies
# ---------------------------------------------------------------------------

if ! command -v jq &>/dev/null; then
    echo "error: jq is required but not installed." >&2
    echo "  macOS: brew install jq" >&2
    echo "  Ubuntu/Debian: sudo apt-get install jq" >&2
    exit 1
fi

if ! command -v curl &>/dev/null; then
    echo "error: curl is required but not installed." >&2
    exit 1
fi

# ---------------------------------------------------------------------------
# env defaults
# ---------------------------------------------------------------------------

: "${BASE_URL:=https://api.talesofai.com}"

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

die() {
    echo "error: $1" >&2
    exit "${2:-1}"
}

require_env() {
    local var="$1"
    if [[ -z "${!var:-}" ]]; then
        die "environment variable $var is not set. See 'neta-dev-app --help' for setup instructions."
    fi
}

auth_header() {
    echo "Authorization: Bearer $DEV_TOKEN"
}

validate_scopes() {
    local scopes="$1"
    if [[ "$scopes" == *"develop"* ]]; then
        die "the 'develop' scope cannot be assigned to third-party apps."
    fi
}

# Usage: api_call METHOD PATH [BODY]
# Prints response body to stdout. Exits non-zero on HTTP error.
api_call() {
    local method="$1"
    local path="$2"
    local body="${3:-}"
    local url="${BASE_URL}${path}"
    local http_code
    local response
    local tmp_headers

    tmp_headers=$(mktemp)
    trap 'rm -f "$tmp_headers"' RETURN

    local curl_opts=(
        -s -D "$tmp_headers"
        -H "$(auth_header)"
        -H "Content-Type: application/json"
        --connect-timeout 10
        --max-time 60
    )

    if [[ -n "$body" ]]; then
        response=$(curl "${curl_opts[@]}" -X "$method" "$url" -d "$body") || die "network error: curl failed"
    else
        response=$(curl "${curl_opts[@]}" -X "$method" "$url") || die "network error: curl failed"
    fi

    http_code=$(awk 'NR==1{print $2}' "$tmp_headers" | tr -d '\r')

    if [[ "$http_code" -ge 400 ]]; then
        echo "HTTP $http_code" >&2
        echo "$response" | jq . >&2 2>/dev/null || echo "$response" >&2
        exit 1
    fi

    echo "$response"
}

# Pretty-print JSON. If stdin is empty, does nothing.
pp_json() {
    jq . 2>/dev/null || cat
}

# Extract a single string field from JSON on stdin.
json_str() {
    jq -r "$1" 2>/dev/null
}
