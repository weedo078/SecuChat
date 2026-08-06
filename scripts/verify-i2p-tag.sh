#!/usr/bin/env bash
# verify-i2p-tag.sh — Verify the GPG signature of the pinned i2p.i2p submodule tag.
#
# Checks (in order):
#   1. Tag exists and carries a "Good signature" via `git tag -v`.
#   2. Commit hash of the tag matches I2P_EXPECTED_COMMIT_SHA (out-of-band pin).
#   3. Optional: signing-key fingerprint matches I2P_ALLOWED_FPR.
#
# Env vars (all optional, defaults set in code):
#   I2P_EXPECTED_TAG        — tag name to verify (default: i2p-2.13.0).
#   I2P_EXPECTED_COMMIT_SHA — commit SHA the tag must resolve to; empty = skip.
#   I2P_ALLOWED_FPR         — required signing-key fingerprint; empty = skip.
#
# Exit codes: 0 on full success, 1 on any verification failure.

set -euo pipefail

EXPECTED_TAG="${I2P_EXPECTED_TAG:-i2p-2.13.0}"
EXPECTED_COMMIT_SHA="${I2P_EXPECTED_COMMIT_SHA:-}"
ALLOWED_SIGNING_FPR="${I2P_ALLOWED_FPR:-}"

# Locate submodule directory relative to this script (works from any CWD).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBMODULE_DIR="$SCRIPT_DIR/../vendor/i2p.i2p"

if [ ! -d "$SUBMODULE_DIR" ]; then
    echo "ERROR: submodule directory not found: $SUBMODULE_DIR" >&2
    exit 1
fi

cd "$SUBMODULE_DIR"

echo "[verify-i2p-tag] Checking tag $EXPECTED_TAG ..."

# Ensure remote tags are present (idempotent; tolerates offline).
if git remote get-url origin >/dev/null 2>&1; then
    git fetch --tags origin 2>/dev/null || true
fi

VERIFY_LOG="$(mktemp)"
trap 'rm -f "$VERIFY_LOG"' EXIT

# 1. Tag signature check (force English locale so "Good signature" is grep-able).
if ! LANG=C LC_ALL=C git tag -v "$EXPECTED_TAG" >"$VERIFY_LOG" 2>&1; then
    cat "$VERIFY_LOG" >&2
    echo "ERROR: git tag -v $EXPECTED_TAG failed (no signature or tag missing)" >&2
    exit 1
fi
cat "$VERIFY_LOG"

if ! grep -q "Good signature" "$VERIFY_LOG"; then
    echo "ERROR: GPG signature on tag $EXPECTED_TAG is missing or BAD" >&2
    exit 1
fi

# 2. Commit-hash pin.
ACTUAL_SHA="$(git rev-parse "${EXPECTED_TAG}^{commit}")"
if [ -n "$EXPECTED_COMMIT_SHA" ] && [ "$ACTUAL_SHA" != "$EXPECTED_COMMIT_SHA" ]; then
    echo "ERROR: tag $EXPECTED_TAG commits to $ACTUAL_SHA, expected $EXPECTED_COMMIT_SHA" >&2
    echo "ERROR: Update I2P_EXPECTED_COMMIT_SHA env var from the out-of-band pin source." >&2
    exit 1
fi
echo "[verify-i2p-tag] Commit $ACTUAL_SHA verified"

# 3. Optional maintainer-key fingerprint check.
if [ -n "$ALLOWED_SIGNING_FPR" ]; then
    ACTUAL_FPR="$(grep -oP 'RSA key [A-F0-9]+' "$VERIFY_LOG" | head -1 | awk '{print $NF}' || true)"
    if [ -n "$ACTUAL_FPR" ] && [ "$ACTUAL_FPR" != "$ALLOWED_SIGNING_FPR" ]; then
        echo "ERROR: signing-key FPR $ACTUAL_FPR != expected $ALLOWED_SIGNING_FPR" >&2
        exit 1
    fi
    if [ -n "$ACTUAL_FPR" ]; then
        echo "[verify-i2p-tag] signing FPR OK: $ACTUAL_FPR"
    else
        echo "[verify-i2p-tag] WARNING: could not extract signing FPR from verify output" >&2
    fi
fi

echo "[verify-i2p-tag] OK: tag $EXPECTED_TAG verified"
