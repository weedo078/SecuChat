# Sprint Plan: Kimi Code Review Fixes

**PR Reference:** #89
**Date:** 2026-03-09
**Total Issues:** 11 (grouped into 4 phases)

---

## Overview

This sprint addresses 11 issues identified by the Kimi Code Review bot on PR #89. Issues are grouped by priority and dependency, with security fixes addressed first, followed by type safety, code quality, performance, and architecture improvements.

---

## Issue Summary

| ID | Issue | Priority | File | Lines |
|---|---|---|---|---|
| 1 | API key exposure in shell environment | High | `kimi-code-review.yml` | 50-52, 70-76 |
| 2 | Prompt injection vulnerability | High | `kimi-code-review.yml` | 58-65 |
| 3 | Platform detection returns unused value, hardcoded provider | Medium | `storage.ts` | 45-51 |
| 4 | Missing null check for provider initialization | Medium | `storage.ts` | 47 |
| 5 | Unbounded diff processing | Quality | `kimi-code-review.yml` | 33-36 |
| 6 | Fragile comment detection | Quality | `kimi-code-review.yml` | 88-94 |
| 7 | Missing data migration for removed encryption | Quality | `storage.ts` | - |
| 8 | Synchronous file I/O and JSON processing | Performance | `kimi-code-review.yml` | 64-76 |
| 9 | Eager provider instantiation | Performance | `storage.ts` | 45-51 |
| 10 | Incomplete abstraction | Architecture | `storage.ts` | 1-41 |
| 11 | Unused permissions | Architecture | `kimi-code-review.yml` | 20-22 |

---

## Phase 1: Security Fixes (Critical)

**Goal:** Address all security vulnerabilities before any other changes.
**Estimated Duration:** 1-2 days
**Dependencies:** None

### Task 1.1: Secure API Key Handling in Workflow
**File:** `.github/workflows/kimi-code-review.yml`
**Lines:** 38-40, 65-67
**Effort:** Medium

**Acceptance Criteria:**
- [ ] API key is passed directly to curl via stdin or environment file, not shell expansion
- [ ] Use `curl --config` or heredoc to avoid exposing key in process list
- [ ] Verify with `ps aux | grep curl` during test run that key is not visible

---

### Task 1.2: Prevent Prompt Injection via Diff Content
**File:** `.github/workflows/kimi-code-review.yml`
**Lines:** 58-62
**Effort:** Medium

**Acceptance Criteria:**
- [ ] Diff content is sanitized/escaped before JSON encoding
- [ ] Use jq's `--arg` or `--argjson` with proper escaping, not string concatenation
- [ ] Add validation that diff content doesn't contain control characters that could break JSON

---

## Phase 2: Type Safety & Runtime Safety

**Goal:** Fix type safety issues and add null checks.
**Estimated Duration:** 1 day
**Dependencies:** Phase 1 (security)

### Task 2.1: Fix Platform Detection Unused Value
**File:** `app/src/services/storage.ts`
**Lines:** 34-38
**Effort:** Small

**Acceptance Criteria:**
- [ ] Remove unused `platform` variable OR use it for provider selection
- [ ] If keeping platform detection, implement proper provider factory that uses the value

---

### Task 2.2: Add Null Check for Provider Initialization
**File:** `app/src/services/storage.ts`
**Lines:** 34-47
**Effort:** Small

**Acceptance Criteria:**
- [ ] Add null check after provider instantiation
- [ ] Add type guard to verify provider implements StorageProvider interface
- [ ] Throw descriptive error if provider fails to initialize

---

## Phase 3: Code Quality & Maintainability

**Goal:** Improve code robustness and maintainability.
**Estimated Duration:** 2-3 days
**Dependencies:** Phase 2 (type safety)

### Task 3.1: Add Diff Size Limits and Validation
**File:** `.github/workflows/kimi-code-review.yml`
**Lines:** 33-36
**Effort:** Small

**Acceptance Criteria:**
- [ ] Enforce `MAX_DIFF_LINES` limit strictly
- [ ] Add file count limit (e.g., max 50 files)
- [ ] Log warning when diff exceeds limits and truncate gracefully

---

### Task 3.2: Improve Comment Detection Robustness
**File:** `.github/workflows/kimi-code-review.yml`
**Lines:** 88-94, 101
**Effort:** Small

**Acceptance Criteria:**
- [ ] Use comment ID or metadata marker instead of string matching
- [ ] Add unique identifier to comment body (e.g., HTML comment `<!-- kimi-review -->`)
- [ ] Handle case where multiple Kimi comments exist

---

### Task 3.3: Implement Data Migration for Encryption Changes
**File:** `app/src/services/storage/browser/provider.ts`
**Lines:** 266-285
**Effort:** Large

**Acceptance Criteria:**
- [ ] Detect legacy encrypted data format
- [ ] Add migration path from old encryption to new AES-GCM format
- [ ] Handle migration failure gracefully
- [ ] Add version marker to stored data

---

## Phase 4: Performance & Architecture

**Goal:** Optimize performance and improve architecture.
**Estimated Duration:** 2-3 days
**Dependencies:** Phase 3 (code quality)

### Task 4.1: Async File I/O and Streaming JSON Processing
**File:** `.github/workflows/kimi-code-review.yml`
**Lines:** 64-76
**Effort:** Medium

**Acceptance Criteria:**
- [ ] Use streaming JSON parser for large responses
- [ ] Process API response as stream instead of loading into memory
- [ ] Add timeout for API call

---

### Task 4.2: Implement Lazy Provider Instantiation
**File:** `app/src/services/storage.ts`
**Lines:** 34-38
**Effort:** Medium

**Acceptance Criteria:**
- [ ] Move provider instantiation from constructor to first use
- [ ] Add `getProvider()` method that creates provider on first call
- [ ] Maintain singleton pattern

---

### Task 4.3: Complete Storage Abstraction Layer
**File:** `app/src/services/storage.ts`
**Lines:** 1-41
**Effort:** Large

**Acceptance Criteria:**
- [ ] Implement proper factory pattern for provider selection
- [ ] Create `ElectronStorageProvider` stub
- [ ] Move platform-specific logic out of `StorageService` into providers

---

### Task 4.4: Remove Unused Workflow Permissions
**File:** `.github/workflows/kimi-code-review.yml`
**Lines:** 13-16
**Effort:** Small

**Acceptance Criteria:**
- [ ] Audit which permissions are actually used
- [ ] Remove `issues: read` if not needed
- [ ] Document why each remaining permission is required

---

## Sprint Board

| Task | Phase | Effort | Status |
|---|---|---|---|
| 1.1 Secure API key handling | 1 | Medium | Todo |
| 1.2 Prompt injection fix | 1 | Medium | Todo |
| 2.1 Fix platform detection | 2 | Small | Todo |
| 2.2 Add null check | 2 | Small | Todo |
| 3.1 Diff size limits | 3 | Small | Todo |
| 3.2 Comment detection | 3 | Small | Todo |
| 3.3 Data migration | 3 | Large | Todo |
| 4.1 Async file I/O | 4 | Medium | Todo |
| 4.2 Lazy instantiation | 4 | Medium | Todo |
| 4.3 Complete abstraction | 4 | Large | Todo |
| 4.4 Remove unused permissions | 4 | Small | Todo |

---

## Success Criteria

- [ ] All 11 issues from Kimi review are resolved
- [ ] Security audit passes (no secrets in logs, no injection vulnerabilities)
- [ ] TypeScript strict mode passes with no errors
- [ ] All existing tests pass
- [ ] Workflow tested on at least 3 PRs of varying sizes
