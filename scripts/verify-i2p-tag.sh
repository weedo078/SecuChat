#!/usr/bin/env bash
# verify-i2p-tag.sh — Verify the GPG signature of the pinned i2p.i2p submodule tag.
#
# Checks (in order):
#   1. Tag exists and carries a "Good signature" via `git tag -v`.
#   2. Commit hash of the tag matches I2P_EXPECTED_COMMIT_SHA (out-of-band pin).
#   3. Optional: signing-key fingerprint matches I2P_ALLOWED_FPR.
#   4. The gitlink checked into the superproject points at that same commit.
#
# CI-Voraussetzungen:
#   gpg --import <(curl -fsSL https://secuchat.app/blog/i2p-pin/i2p-maintainer.asc)
#   gpg --import-ownertrust <(echo "<fpr>:6:")
# Oder: secuchat.app/blog/i2p-pin als Quelle fuer den aktuellen, signierten Maintainer-Key.
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

# Submodul muss initialisiert sein (checked-out submodules carry a .git *file*).
if [ ! -e .git ]; then
    echo "ERROR: vendor/i2p.i2p not initialized. Run:" >&2
    echo "       git submodule update --init vendor/i2p.i2p" >&2
    exit 1
fi

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

# 3. Optional maintainer-key fingerprint check (fail-closed once opted in).
if [ -n "$ALLOWED_SIGNING_FPR" ]; then
    # POSIX ERE (not GNU -P) so this also runs under busybox/Alpine/macOS grep.
    ACTUAL_FPR="$(grep -oE 'using [A-Z0-9]+ key [A-F0-9]{16,}' "$VERIFY_LOG" | head -1 | awk '{print $NF}')"
    if [ -z "$ACTUAL_FPR" ]; then
        echo "ERROR: unable to extract signing FPR from git tag -v output" >&2
        echo "ERROR: (grep regex or git/gpg output format may have changed)" >&2
        exit 1
    fi
    if [ "$ACTUAL_FPR" != "$ALLOWED_SIGNING_FPR" ]; then
        echo "ERROR: signing-key FPR $ACTUAL_FPR != expected $ALLOWED_SIGNING_FPR" >&2
        exit 1
    fi
    echo "[verify-i2p-tag] signing FPR OK: $ACTUAL_FPR"
fi

# 4. The gitlink checked into the superproject must be the verified tag commit.
#    `git ls-files --stage` prints "<mode> <sha> <stage>\t<path>".
GITLINK_SHA="$(git -C "$SCRIPT_DIR/.." ls-files --stage vendor/i2p.i2p \
    | awk '$4 == "vendor/i2p.i2p" { print $2 }')"
if [ -z "$GITLINK_SHA" ]; then
    echo "ERROR: no gitlink entry for vendor/i2p.i2p in the superproject index" >&2
    exit 1
fi
if [ "$GITLINK_SHA" != "$ACTUAL_SHA" ]; then
    echo "ERROR: gitlink $GITLINK_SHA != tag-commit $ACTUAL_SHA" >&2
    echo "ERROR: The checked-in submodule pointer does not match the verified tag." >&2
    exit 1
fi
echo "[verify-i2p-tag] gitlink $GITLINK_SHA matches tag $EXPECTED_TAG"

echo "[verify-i2p-tag] OK: tag $EXPECTED_TAG verified"
