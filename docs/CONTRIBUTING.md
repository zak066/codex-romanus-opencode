# Contributing to Codex Romanus

> Guidelines for contributing code, documentation, and infrastructure to the multi-agent AI team project.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Development Workflow](#development-workflow)
- [Branch Naming](#branch-naming)
- [Commit Messages](#commit-messages)
- [Pull Request Process](#pull-request-process)
- [Testing Requirements](#testing-requirements)
- [Code Style](#code-style)
- [File Change Journal](#file-change-journal)
- [Documentation](#documentation)
- [MCP Server Contributions](#mcp-server-contributions)
- [Release Process](#release-process)

---

## Code of Conduct

All contributors are expected to adhere to the following principles:

1. **Respect agent roles** — each agent has a defined scope (see [AGENTS.md](AGENTS.md))
2. **Follow Lex Agentium** — the mandatory 4-phase protocol for every task
3. **No silent failures** — always log errors and escalate when blocked
4. **Document your work** — every file change must be journaled
5. **Keep it simple** — avoid over-engineering. Prefer readable code over clever code

---

## Development Workflow

Codex Romanus follows a **forking workflow** with feature branches:

```text
1. Fork the repository on GitHub
2. Clone your fork locally
3. Create a feature branch from `main`
4. Make changes following the guidelines below
5. Run tests and quality checks locally
6. Push your branch and open a Pull Request
7. Address review feedback
8. Merge after approval
```

---

## Branch Naming

Branches must follow a strict naming convention with a **type prefix** and a **short kebab-case description**:

| Prefix | Purpose | Example |
|--------|---------|---------|
| `feature/` | New functionality | `feature/tabularium-fts-search` |
| `fix/` | Bug fixes | `fix/ianus-rollback-empty-file` |
| `docs/` | Documentation only | `docs/eng-getting-started-guide` |
| `refactor/` | Code restructuring | `refactor/speculum-fetch-pipeline` |
| `test/` | Test additions or fixes | `test/imago-coverage-edge-cases` |
| `perf/` | Performance improvements | `perf/tabularium-query-indexing` |
| `chore/` | Tooling, dependencies, CI | `chore/update-node-to-24` |

```bash
# Good
git checkout -b feature/messaging-read-receipts
git checkout -b fix/ianus-symlink-windows

# Bad — no prefix, too vague
git checkout -b my-changes
git checkout -b fix-stuff
```

---

## Commit Messages

Use **Conventional Commits** (v1.0.0) for all commits. This enables automated changelog generation and semantic versioning.

### Format

```
<type>(<scope>): <short summary>

[optional body — detailed explanation]

[optional footer(s)]
```

### Types

| Type | When to Use |
|------|-------------|
| `feat` | A new feature for a user or agent |
| `fix` | A bug fix |
| `docs` | Documentation changes only |
| `style` | Code formatting, missing semicolons, etc. (no logic change) |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf` | A code change that improves performance |
| `test` | Adding or correcting tests |
| `chore` | Build process, dependencies, CI, tooling |
| `security` | Security fixes or vulnerability patches |

### Scopes

| Scope | Area |
|-------|------|
| `tabularium` | Governance server (memory, ADR, metrics) |
| `ianus` | Filesystem server |
| `speculum` | Web search server |
| `imago` | Image generation server |
| `praetorium` | Dashboard |
| `agents` | Agent configuration or protocol |
| `docs` | Documentation |
| `infra` | CI/CD, Docker, deployment |

### Examples

```text
feat(tabularium): add FTS5 full-text search for messages

Implement FTS5 virtual table on the messaging channel to support
fast full-text search across all agent communications.

Closes #142
```

```text
fix(ianus): handle empty files in fs_rollback

Skip SHA-256 hash computation for empty files (size 0)
to prevent crypto module errors on rollback.

Fixes #89
```

```text
docs(agents): add MCP server permission tier table

Document the 5-tier permission model for all 12 agents
in AGENTS.md with tool access matrix.
```

---

## Pull Request Process

### 1. Before Opening

- [ ] Branch is up to date with `main` (`git rebase main`)
- [ ] All existing tests pass (`npx vitest run`)
- [ ] TypeScript compiles with zero errors (`npx tsc --noEmit`)
- [ ] Lint passes (`npx eslint .`)
- [ ] Changes are journaled (see [File Change Journal](#file-change-journal))

### 2. PR Description Template

```markdown
## Summary
<!-- One-sentence description of the change -->

## Related Issue
<!-- Closes #N or Relates to #N -->

## Type of Change
- [ ] feat
- [ ] fix
- [ ] docs
- [ ] refactor
- [ ] chore

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manual testing performed

## Checklist
- [ ] TSC 0 errors
- [ ] Vitest tests pass
- [ ] Coverage meets threshold (80%+)
- [ ] Journal log entries added
- [ ] Documentation updated (if applicable)

## Screenshots (if frontend)
```

### 3. Review Process

| Step | Who | Description |
|------|-----|-------------|
| **Draft PR** | Author | Open as draft for early feedback |
| **Automated checks** | CI | Quality gate + test suite run automatically |
| **Code review** | 2 reviewers | Style, correctness, architecture |
| **Security review** | @janus-security | Required for auth, secrets, encryption |
| **Architecture review** | @minerva-architect | Required for new MCP tools or ADR changes |
| **Merge** | Maintainer | Squash-merge into `main` |

### 4. Merge Requirements

- ✅ At least **1 approval** (2 for multi-server changes)
- ✅ All CI checks pass
- ✅ No merge conflicts
- ✅ Branch is up to date with `main`

---

## Testing Requirements

### Mandatory Checks

Every contribution must pass these checks before merge:

```bash
# 1. TypeScript compilation — zero errors
npx tsc --noEmit

# 2. Unit tests — all pass
npx vitest run

# 3. Lint — zero errors
npx eslint . --max-warnings 0

# 4. Coverage — minimum thresholds
#    Statements: 80%+
#    Branches:   75%+
#    Functions:  85%+
#    Lines:      80%+

# 5. Quality gate (Tabularium)
npx tabularium quality-gate
```

### Test Structure

Tests live in `__tests__/` directories within each subproject:

```
tabularium/
├── src/
│   ├── tools/
│   │   ├── compact.tool.ts
│   │   └── purge.tool.ts
├── __tests__/
│   ├── tools/
│   │   ├── compact.tool.test.ts
│   │   └── purge.tool.test.ts
│   └── integration/
│       └── memory-workflow.test.ts
```

### Test Naming Conventions

- Unit tests: `<module>.test.ts`
- Integration tests: `<workflow>.test.ts`
- Use descriptive test names: `should reject purge when dryRun is true`

### Coverage Goals

| Metric | Minimum Target | Stretch Target |
|--------|:--------------:|:--------------:|
| Statements | 80% | 90% |
| Branches | 75% | 85% |
| Functions | 85% | 95% |
| Lines | 80% | 90% |

---

## Code Style

### TypeScript

- **Strict mode**: `strict: true` in `tsconfig.json` (no exceptions)
- **Target**: `ES2022` (Node.js 22+ native support)
- **Module**: `ESNext` with `NodeNext` module resolution
- **No `any`**: Use `unknown` instead and narrow with type guards
- **No `// @ts-ignore`**: Prefer `// @ts-expect-error` with a reason comment
- **Prefer `const`**: Never use `var`. `let` only when reassignment is required

```typescript
// Good
type ApiResponse<T> = { data: T; error: null } | { data: null; error: string };

function parseResult<T>(input: unknown): ApiResponse<T> {
  if (typeof input !== 'object' || input === null) {
    return { data: null, error: 'Invalid input' };
  }
  return { data: input as T, error: null };
}

// Bad
function parseResult(input: any): any {
  return input; // Loss of type safety
}
```

### ESLint + Prettier

Codex Romanus uses a shared ESLint + Prettier configuration:

```bash
# Check lint
npx eslint . --max-warnings 0

# Auto-fix
npx eslint . --fix

# Format
npx prettier --write .
```

Key rules:
- **2-space indentation** (no tabs)
- **Single quotes** for strings
- **Semicolons required**
- **Trailing commas** in multiline statements
- **Max line length**: 100 characters

### Ianus for File Operations

**Never use bash for file modification.** Always use the **Ianus Liminalis** MCP server:

```typescript
// ✅ Correct — use Ianus tools
const result = await ianusLiminalis.fsWrite({
  path: 'src/config.ts',
  content: 'export const VERSION = "2.0.0";'
});

// ❌ Wrong — never use fs.writeFileSync or bash echo
fs.writeFileSync('src/config.ts', '...');
```

### Error Handling

```typescript
// Good — structured error handling
try {
  const result = await someOperation();
  if (!result.success) {
    throw new AppError('Operation failed', { cause: result.error });
  }
} catch (error) {
  logger.error({ err: error, operation: 'someOperation' }, 'Operation failed');
  throw error; // Re-throw — caller handles escalation
}

// Bad — silent catch
try {
  await someOperation();
} catch {
  // Silently swallowing errors makes debugging impossible
}
```

### File Organization

```
src/
├── index.ts            # Entry point
├── types/              # TypeScript type definitions
├── tools/              # MCP tool implementations
├── services/           # Business logic
└── utils/              # Utility functions
```

---

## File Change Journal

Every file modification **must** be logged via `tabularium_journal_log`. This creates an immutable audit trail.

### When to Log

| Operation | Journal Entry |
|-----------|---------------|
| Creating a new file | ✅ `change_type: "created"` |
| Editing an existing file | ✅ `change_type: "modified"` |
| Deleting a file | ✅ `change_type: "deleted"` |
| Renaming a file | ✅ `change_type: "renamed"` |
| Reading a file | ❌ Not required |

### Journal Log Format

```json
tabularium_journal_log(
  file_path="src/tools/my-tool.ts",
  agent="mercurius-junior-dev",
  change_type="created",
  summary="Add MyTool: validates input before processing",
  session_id="sess_abc123",
  task_id="task_456"
)
```

### Best Practices

- **Log immediately** after the file operation — do not batch
- **Be specific** in the summary: explain *what* changed and *why*
- **Include the session_id** when available (links changes to tasks)
- **Never skip** journal logging — it's mandatory for quality scorecard compliance

---

## Documentation

### English Documentation

All user-facing documentation in `docs/eng/` must be in **clear technical English**:

| Document | Audience | Purpose |
|----------|----------|---------|
| `README.md` | All users | Project overview, quick start, agent table |
| `AGENTS.md` | Developers | Agent roles, protocols, delegation |
| `ARCHITECTURE.md` | Architects | System design, MCP server architecture |
| `MCP-SERVERS.md` | Developers | MCP server reference (all 6 servers) |
| `GETTING-STARTED.md` | New users | Complete setup and verification guide |
| `CONTRIBUTING.md` | Contributors | This file — contributing guidelines |

### API Documentation

Every exported function and MCP tool must have JSDoc/TSDoc comments:

```typescript
/**
 * Register a new metric value in the time-series database.
 *
 * @param domain - Metric domain (quality, perf, security, test, seo, devops)
 * @param metricName - Metric name (alphanumeric, max 100 chars)
 * @param value - Numeric value to record
 * @param tags - Optional metadata (agent, file, branch)
 * @returns The created metric record
 * @throws {ValidationError} If domain is invalid or value is NaN
 *
 * @example
 * ```typescript
 * await metricsStore('perf', 'api_latency_ms', 42, { agent: 'scipione' });
 * ```
 */
```

### Changelog

The project uses **Keep a Changelog** format. Every significant change should be documented:

```
# Changelog

## [2.1.0] - 2026-06-15

### Added
- FTS5 full-text search for messaging (#142)
- Praetorium agent status board (#158)

### Fixed
- Ianus rollback on empty files (#89)

### Changed
- Upgraded TypeScript to 5.8
```

---

## MCP Server Contributions

### Architecture Principles

When contributing to an MCP server:

1. **Single responsibility**: Each tool does one thing well
2. **Atomic backups**: Always create backups before destructive operations
3. **Permission aware**: Respect the 5-tier permission model
4. **Journaled**: Every write operation logs to the file change journal
5. **Tested**: Each tool has unit tests + integration tests

### Adding a New Tool

1. Create the tool file in `src/tools/`
2. Register it in the server's tool registry
3. Add JSDoc with `@param` and `@returns` tags
4. Write unit tests in `__tests__/tools/`
5. Log via `tabularium_journal_log` on write operations
6. Update the server's API documentation
7. Add an ADR for significant architectural decisions

### Permission Tier Mapping

| Tier | Color | Agents | Can Do |
|------|-------|--------|--------|
| Core Dev | 🔴 | vulcanus, catone, agrippa, iuppiter | All operations |
| Tester/Frontend | 🟡 | ovidio, plinio, diana | Read, write, edit, delete |
| Junior/Docs | 🟢 | mercurius, tacito | Read, write, edit |
| Read-only | 🔵 | janus, scipione, minerva | Read, search, tree |

---

## Release Process

### Versioning

Codex Romanus follows **Semantic Versioning** (SemVer 2.0.0):

| Bump | When | Example |
|------|------|---------|
| **Major** | Breaking API changes, agent protocol changes | `2.0.0 → 3.0.0` |
| **Minor** | New features, new tools, non-breaking additions | `2.0.0 → 2.1.0` |
| **Patch** | Bug fixes, documentation, refactoring | `2.0.0 → 2.0.1` |

### Release Steps

```text
1. Create release branch: release/vX.Y.Z
2. Update version in package.json files
3. Run full quality gate (lint → TSC → test → coverage → audit)
4. Generate CHANGELOG.md from Conventional Commits
5. Create GitHub Release with tag vX.Y.Z
6. Merge release branch into main
7. Deploy MCP servers (production)
```

---

## Getting Help

| Resource | Where |
|----------|-------|
| **Agent documentation** | `docs/eng/` directory |
| **Architecture decisions** | `docs/adr/` directory |
| **Open a discussion** | GitHub Discussions |
| **Report a bug** | GitHub Issues (use bug template) |
| **Security issue** | DM @janus-security or security@codex-romanus.dev |

> **Remember**: Every contribution, no matter how small, strengthens the Codex Romanus ecosystem. Welcome aboard! 🏛️
