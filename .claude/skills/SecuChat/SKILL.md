# SecuChat Development Patterns

> Auto-generated skill from repository analysis

## Overview
SecuChat is a secure chat application built with TypeScript, featuring an Electron desktop client and web components. The codebase follows modern TypeScript patterns with React components, emphasizes security through I2P integration, and maintains automated release workflows. The project uses conventional commits and structured CI/CD pipelines for reliable deployments.

## Coding Conventions

### File Naming
Use **camelCase** for all file names:
```
appContext.tsx
storageService.ts
messageHandler.ts
```

### Import Style
Use **alias imports** for clean module resolution:
```typescript
import { AppContext } from '@/contexts/AppContext';
import { StorageService } from '@/services/storage';
import type { MessageType } from '@/types/message';
```

### Export Style
Mixed export patterns are used throughout the codebase:
```typescript
// Named exports for utilities
export const formatMessage = (msg: string) => { ... };
export const validateInput = (input: string) => { ... };

// Default exports for components
export default function ChatComponent() { ... }
```

### Commit Messages
Follow conventional commit format:
```
feat: add message encryption functionality
fix: resolve connection timeout issues
chore: update dependencies to latest versions
ci: improve build performance
```
Keep commit messages around 52 characters for consistency.

## Workflows

### Version Bump Release
**Trigger:** When changes are merged to main and ready for release
**Command:** `/bump-version`

1. Increment version number following semantic versioning
2. Update `app/package.json` with new version
3. Update `electron/package.json` with matching version
4. Create commit with `[skip ci]` tag to avoid triggering build
5. Push changes to trigger release workflow

Example version update:
```json
{
  "name": "secuchat",
  "version": "1.2.3", // Increment patch, minor, or major
  "description": "Secure chat application"
}
```

### Dependency Update
**Trigger:** When dependabot creates PRs for package updates
**Command:** `/update-deps`

1. Review dependabot PR for security and compatibility
2. Update `package.json` files in both app and electron directories
3. Regenerate `package-lock.json` files
4. Test locally to ensure no breaking changes
5. Merge dependency changes with appropriate commit message

Example dependency update:
```bash
cd app && npm update
cd ../electron && npm update
npm audit fix
```

### CI Workflow Update
**Trigger:** When CI/CD pipeline needs modifications or GitHub Actions need updates
**Command:** `/update-ci`

1. Modify workflow files in `.github/workflows/`
2. Update GitHub Action versions to latest stable
3. Adjust build steps for new requirements
4. Fix CI permissions or environment configurations
5. Test workflow changes on feature branch first

Common workflow files to update:
- `release.yml` - Production releases
- `ci.yml` - Continuous integration
- `pr-build.yml` - Pull request builds
- `version-bump.yml` - Automated version management

### Bug Fix Implementation
**Trigger:** When bugs are identified in app functionality
**Command:** `/fix-bug`

1. Identify root cause through debugging and logs
2. Update affected React components in `components/custom/`
3. Fix service layer issues in `services/` directory
4. Update context providers if state management affected
5. Add regression tests to prevent future occurrences

Common files involved in bug fixes:
```typescript
// Context updates
app/src/contexts/AppContext.tsx

// Service layer fixes  
app/src/services/storage.ts
app/src/services/i2p.ts

// Component fixes
app/src/components/custom/ChatView.tsx
app/src/components/custom/AddContactDialog.tsx
```

## Testing Patterns

### Test Framework
Uses **Vitest** for fast unit testing:

```typescript
// messageHandler.test.ts
import { describe, it, expect } from 'vitest';
import { formatMessage } from './messageHandler';

describe('Message Handler', () => {
  it('should format message correctly', () => {
    const result = formatMessage('Hello World');
    expect(result).toBe('Hello World');
  });
});
```

### Test File Pattern
All test files follow the pattern: `*.test.ts`
```
src/
  services/
    storage.ts
    storage.test.ts
  components/
    ChatView.tsx
    ChatView.test.ts
```

## Commands

| Command | Purpose |
|---------|---------|
| `/bump-version` | Increment version numbers and prepare release |
| `/update-deps` | Handle dependabot PRs and dependency updates |
| `/update-ci` | Modify GitHub Actions workflows and CI config |
| `/fix-bug` | Implement bug fixes across app components |
| `/test` | Run vitest test suite |
| `/build` | Build both app and electron packages |
| `/lint` | Run TypeScript and code quality checks |