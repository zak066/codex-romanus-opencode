/**
 * fs_validate_config — Ianus Liminalis
 *
 * Valida file di configurazione contro regole specifiche per tipo.
 * Supporta: eslintrc, tsconfig, prettierrc, package.json, .npmrc.
 * Auto-detect del tipo dal nome file.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

type ConfigType = 'eslint' | 'tsconfig' | 'prettier' | 'package' | 'npmrc';

interface ValidationIssue {
  field: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

interface ValidateConfigResult {
  valid: boolean;
  type: ConfigType;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  fields: number;
}

// ────────────────────────────────────────────────────────────
// Semver regex (simple)
// ────────────────────────────────────────────────────────────

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?(?:\+[a-zA-Z0-9.]+)?$/;

// ────────────────────────────────────────────────────────────
// URL validation regex
// ────────────────────────────────────────────────────────────

const URL_RE = /^https?:\/\/.+/;

// ────────────────────────────────────────────────────────────
// Valid TypeScript targets and modules
// ────────────────────────────────────────────────────────────

const VALID_TS_TARGETS = new Set([
  'ES3', 'ES5', 'ES2015', 'ES2016', 'ES2017', 'ES2018', 'ES2019',
  'ES2020', 'ES2021', 'ES2022', 'ES2023', 'ES2024', 'ESNext',
  'es3', 'es5', 'es2015', 'es2016', 'es2017', 'es2018', 'es2019',
  'es2020', 'es2021', 'es2022', 'es2023', 'es2024', 'esnext',
]);

const VALID_TS_MODULES = new Set([
  'CommonJS', 'AMD', 'System', 'UMD', 'ES6', 'ES2015', 'ES2020',
  'ES2022', 'ESNext', 'Node16', 'NodeNext', 'None',
  'commonjs', 'amd', 'system', 'umd', 'es6', 'es2015', 'es2020',
  'es2022', 'esnext', 'node16', 'nodenext', 'none',
]);

// ────────────────────────────────────────────────────────────
// Type detection from filename
// ────────────────────────────────────────────────────────────

function detectConfigType(filePath: string, explicitType?: string): ConfigType {
  if (explicitType) {
    const valid: ConfigType[] = ['eslint', 'tsconfig', 'prettier', 'package', 'npmrc'];
    if (valid.includes(explicitType as ConfigType)) {
      return explicitType as ConfigType;
    }
    throw new Error(
      `Unknown config type "${explicitType}". Valid types: ${valid.join(', ')}`,
    );
  }

  const base = basename(filePath).toLowerCase();

  // ESLint: .eslintrc* (eslintrc.json, .eslintrc.js, .eslintrc.yaml, etc.)
  if (base.startsWith('.eslintrc') || base === 'eslint.config.js' || base === 'eslint.config.mjs') {
    return 'eslint';
  }

  // tsconfig: tsconfig*.json
  if (base.startsWith('tsconfig') && (base.endsWith('.json'))) {
    return 'tsconfig';
  }

  // Prettier: .prettierrc*, prettier.config.*
  if (
    base.startsWith('.prettierrc') ||
    base.startsWith('prettier.config.')
  ) {
    return 'prettier';
  }

  // package.json
  if (base === 'package.json') {
    return 'package';
  }

  // .npmrc
  if (base === '.npmrc') {
    return 'npmrc';
  }

  throw new Error(
    `Unable to detect config type from filename "${basename(filePath)}". ` +
    `Supported files: .eslintrc*, tsconfig*.json, .prettierrc*, prettier.config.*, ` +
    `package.json, .npmrc. Use "type" parameter to specify explicitly.`,
  );
}

// ────────────────────────────────────────────────────────────
// Parsing helpers
// ────────────────────────────────────────────────────────────

function parseJSON(content: string): Record<string, unknown> {
  return JSON.parse(content) as Record<string, unknown>;
}

// ────────────────────────────────────────────────────────────
// Validators per type
// ────────────────────────────────────────────────────────────

function validateEslint(
  config: Record<string, unknown>,
): ValidateConfigResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  let fields = 0;

  // Check extends or plugins
  if (!('extends' in config) && !('plugins' in config)) {
    errors.push({
      field: 'extends/plugins',
      message: 'ESLint config should have "extends" or "plugins" defined',
      severity: 'error',
    });
  }
  fields++;

  // Check rules
  if ('rules' in config) {
    fields++;
    if (typeof config.rules !== 'object' || config.rules === null || Array.isArray(config.rules)) {
      errors.push({
        field: 'rules',
        message: '"rules" must be an object',
        severity: 'error',
      });
    }
  } else {
    warnings.push({
      field: 'rules',
      message: 'No "rules" defined — consider adding lint rules',
      severity: 'info',
    });
  }

  // Check parser
  if ('parser' in config) {
    fields++;
    if (typeof config.parser !== 'string') {
      errors.push({
        field: 'parser',
        message: '"parser" must be a string',
        severity: 'error',
      });
    }
  }

  // Check env
  if ('env' in config) {
    fields++;
    if (typeof config.env !== 'object' || config.env === null || Array.isArray(config.env)) {
      errors.push({
        field: 'env',
        message: '"env" must be an object',
        severity: 'error',
      });
    }
  }

  return {
    valid: errors.length === 0,
    type: 'eslint',
    errors,
    warnings,
    fields,
  };
}

function validateTsconfig(
  config: Record<string, unknown>,
): ValidateConfigResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  let fields = 0;

  // Must have compilerOptions
  if (!('compilerOptions' in config)) {
    errors.push({
      field: 'compilerOptions',
      message: 'tsconfig must have "compilerOptions" defined',
      severity: 'error',
    });
    return {
      valid: false,
      type: 'tsconfig',
      errors,
      warnings,
      fields,
    };
  }

  fields++;

  const compilerOptions = config.compilerOptions as Record<string, unknown>;

  // Check target
  if ('target' in compilerOptions) {
    fields++;
    const target = compilerOptions.target as string;
    if (!VALID_TS_TARGETS.has(target)) {
      warnings.push({
        field: 'compilerOptions.target',
        message: `"${target}" is not a standard TypeScript target. Expected: ES20xx, ESNext`,
        severity: 'warning',
      });
    }
  } else {
    warnings.push({
      field: 'compilerOptions.target',
      message: '"compilerOptions.target" is not set — defaults to ES3/ES5 in older TS',
      severity: 'info',
    });
  }

  // Check module
  if ('module' in compilerOptions) {
    fields++;
    const mod = compilerOptions.module as string;
    if (!VALID_TS_MODULES.has(mod)) {
      warnings.push({
        field: 'compilerOptions.module',
        message: `"${mod}" is not a standard TypeScript module setting`,
        severity: 'warning',
      });
    }
  } else {
    warnings.push({
      field: 'compilerOptions.module',
      message: '"compilerOptions.module" is not set',
      severity: 'info',
    });
  }

  // Check strict
  if ('strict' in compilerOptions) {
    fields++;
    if (compilerOptions.strict !== true) {
      warnings.push({
        field: 'compilerOptions.strict',
        message: '"strict: true" is strongly recommended for type safety',
        severity: 'warning',
      });
    }
  } else {
    warnings.push({
      field: 'compilerOptions.strict',
      message: '"strict" is not set — consider enabling it for type safety',
      severity: 'warning',
    });
  }

  // Check include
  if ('include' in config) {
    fields++;
    if (!Array.isArray(config.include)) {
      errors.push({
        field: 'include',
        message: '"include" must be an array of glob patterns',
        severity: 'error',
      });
    }
  }

  // Check exclude
  if ('exclude' in config) {
    fields++;
    if (!Array.isArray(config.exclude)) {
      errors.push({
        field: 'exclude',
        message: '"exclude" must be an array of glob patterns',
        severity: 'error',
      });
    }
  }

  return {
    valid: errors.length === 0,
    type: 'tsconfig',
    errors,
    warnings,
    fields,
  };
}

function validatePrettier(
  config: Record<string, unknown>,
): ValidateConfigResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  let fields = 0;

  // Check singleQuote
  if ('singleQuote' in config) {
    fields++;
    if (typeof config.singleQuote !== 'boolean') {
      errors.push({
        field: 'singleQuote',
        message: '"singleQuote" must be a boolean',
        severity: 'error',
      });
    }
  }

  // Check trailingComma
  if ('trailingComma' in config) {
    fields++;
    if (typeof config.trailingComma !== 'boolean' && config.trailingComma !== 'all' && config.trailingComma !== 'es5' && config.trailingComma !== 'none') {
      errors.push({
        field: 'trailingComma',
        message: '"trailingComma" must be a boolean, "all", "es5", or "none"',
        severity: 'error',
      });
    }
  }

  // Check tabWidth
  if ('tabWidth' in config) {
    fields++;
    if (typeof config.tabWidth !== 'number' || config.tabWidth < 1) {
      errors.push({
        field: 'tabWidth',
        message: '"tabWidth" must be a positive number',
        severity: 'error',
      });
    }
  }

  // Check printWidth
  if ('printWidth' in config) {
    fields++;
    if (typeof config.printWidth !== 'number' || config.printWidth < 1) {
      errors.push({
        field: 'printWidth',
        message: '"printWidth" must be a positive number',
        severity: 'error',
      });
    }
  }

  // Check semi
  if ('semi' in config) {
    fields++;
    if (typeof config.semi !== 'boolean') {
      errors.push({
        field: 'semi',
        message: '"semi" must be a boolean',
        severity: 'error',
      });
    }
  }

  // Check bracketSpacing
  if ('bracketSpacing' in config) {
    fields++;
    if (typeof config.bracketSpacing !== 'boolean') {
      errors.push({
        field: 'bracketSpacing',
        message: '"bracketSpacing" must be a boolean',
        severity: 'error',
      });
    }
  }

  return {
    valid: errors.length === 0,
    type: 'prettier',
    errors,
    warnings,
    fields,
  };
}

function validatePackage(
  config: Record<string, unknown>,
): ValidateConfigResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  let fields = 0;

  // Check name
  fields++;
  if (!('name' in config)) {
    errors.push({
      field: 'name',
      message: '"name" is required in package.json',
      severity: 'error',
    });
  } else if (typeof config.name !== 'string' || config.name.trim() === '') {
    errors.push({
      field: 'name',
      message: '"name" must be a non-empty string',
      severity: 'error',
    });
  }

  // Check version
  fields++;
  if (!('version' in config)) {
    errors.push({
      field: 'version',
      message: '"version" is required in package.json',
      severity: 'error',
    });
  } else if (typeof config.version !== 'string') {
    errors.push({
      field: 'version',
      message: '"version" must be a string',
      severity: 'error',
    });
  } else if (!SEMVER_RE.test(config.version)) {
    warnings.push({
      field: 'version',
      message: `"${config.version}" is not a valid semver version (expected: X.Y.Z)`,
      severity: 'warning',
    });
  }

  // Check dependencies
  if ('dependencies' in config) {
    fields++;
    if (typeof config.dependencies !== 'object' || config.dependencies === null || Array.isArray(config.dependencies)) {
      errors.push({
        field: 'dependencies',
        message: '"dependencies" must be an object',
        severity: 'error',
      });
    }
  }

  // Check devDependencies
  if ('devDependencies' in config) {
    fields++;
    if (typeof config.devDependencies !== 'object' || config.devDependencies === null || Array.isArray(config.devDependencies)) {
      errors.push({
        field: 'devDependencies',
        message: '"devDependencies" must be an object',
        severity: 'error',
      });
    }
  }

  // Check scripts
  if ('scripts' in config) {
    fields++;
    if (typeof config.scripts !== 'object' || config.scripts === null || Array.isArray(config.scripts)) {
      errors.push({
        field: 'scripts',
        message: '"scripts" must be an object',
        severity: 'error',
      });
    }
  }

  // Check main/module
  if ('main' in config) {
    fields++;
    if (typeof config.main !== 'string') {
      errors.push({
        field: 'main',
        message: '"main" must be a string',
        severity: 'error',
      });
    }
  }

  return {
    valid: errors.length === 0,
    type: 'package',
    errors,
    warnings,
    fields,
  };
}

function validateNpmrc(
  content: string,
): ValidateConfigResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  let fields = 0;

  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines and comments
    if (!line || line.startsWith('#')) continue;

    fields++;

    // Must be key=value
    if (!line.includes('=')) {
      errors.push({
        field: `line ${i + 1}`,
        message: `Expected "key=value" format, got "${line}"`,
        severity: 'error',
      });
      continue;
    }

    const eqIdx = line.indexOf('=');
    const key = line.slice(0, eqIdx).trim();
    const value = line.slice(eqIdx + 1).trim();

    if (!key) {
      errors.push({
        field: `line ${i + 1}`,
        message: 'Empty key in key=value pair',
        severity: 'error',
      });
      continue;
    }

    // Check registry value is a URL
    if (key === 'registry') {
      if (!URL_RE.test(value)) {
        errors.push({
          field: 'registry',
          message: `"registry" must be a valid URL (http/https), got "${value}"`,
          severity: 'error',
        });
      }
    }

    // Warn about auth tokens in config
    if (key.includes('_authToken') || key.includes('_auth') || key.includes('_password')) {
      warnings.push({
        field: `line ${i + 1}`,
        message: `"${key}" contains authentication tokens — consider using environment variables or .npmrc with restricted permissions`,
        severity: 'warning',
      });
    }

    // Warn about email in config
    if (key === 'email') {
      warnings.push({
        field: 'email',
        message: '"email" in .npmrc — ensure this is intentionally committed',
        severity: 'info',
      });
    }
  }

  if (fields === 0) {
    warnings.push({
      field: 'file',
      message: '.npmrc file is empty or contains only comments',
      severity: 'info',
    });
  }

  return {
    valid: errors.length === 0,
    type: 'npmrc',
    errors,
    warnings,
    fields,
  };
}

// ────────────────────────────────────────────────────────────
// Main validation dispatcher
// ────────────────────────────────────────────────────────────

function validateByType(
  type: ConfigType,
  content: string,
): ValidateConfigResult {
  switch (type) {
    case 'npmrc':
      return validateNpmrc(content);
    case 'package':
      return validatePackage(parseJSON(content));
    case 'eslint':
      return validateEslint(parseJSON(content));
    case 'tsconfig':
      return validateTsconfig(parseJSON(content));
    case 'prettier':
      return validatePrettier(parseJSON(content));
  }
}

// ────────────────────────────────────────────────────────────
// Tool Registration
// ────────────────────────────────────────────────────────────

export function registerValidateConfig(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_validate_config',
    description:
      'Validate a configuration file against type-specific rules. ' +
      'Supports: eslint (.eslintrc*), tsconfig (tsconfig*.json), ' +
      'prettier (.prettierrc*, prettier.config.*), package.json, .npmrc. ' +
      'Auto-detects config type from filename. ' +
      'Returns structured errors, warnings, and field counts.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path of the config file to validate (relative to workspace)',
        },
        type: {
          type: 'string',
          enum: ['eslint', 'tsconfig', 'prettier', 'package', 'npmrc'],
          description:
            'Config type (optional, auto-detected from filename if omitted)',
        },
        agent: {
          type: 'string',
          description:
            'Nome dell agente chiamante (opzionale, default: "ianus")',
        },
      },
      required: ['path'],
    },
    handler: async (args) => {
      const filePath = args.path as string | undefined;
      if (!filePath) {
        return {
          content: [{ type: 'text', text: 'Missing required parameter: "path"' }],
          isError: true,
        };
      }

      const explicitType = args.type as string | undefined;
      const callerAgent = (args.agent as string) || 'ianus';

      // Permission check (read)
      const permCheck = await deps.permission.checkOperation(
        callerAgent,
        'read',
        filePath,
        deps.workspaceRoot,
      );
      if (!permCheck.allowed) {
        return {
          content: [{ type: 'text', text: `Permission denied: ${permCheck.reason}` }],
          isError: true,
        };
      }

      try {
        const safePath = resolveSafePath(filePath, deps.workspaceRoot);
        const content = await readFile(safePath, 'utf-8');

        // Detect type
        let configType: ConfigType;
        try {
          configType = detectConfigType(filePath, explicitType);
        } catch (err) {
          return {
            content: [{ type: 'text', text: (err as Error).message }],
            isError: true,
          };
        }

        // Validate
        const result = validateByType(configType, content);

        // Log to journal
        await logToJournal(deps.workspaceRoot, {
          agent: 'ianus',
          operation: 'validate_config',
          path: filePath,
          details: {
            type: result.type,
            valid: result.valid,
            errors: result.errors.length,
            warnings: result.warnings.length,
            fields: result.fields,
          },
        });

        serverStats.increment();

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  valid: false,
                  type: 'unknown',
                  errors: [{ field: 'file', message: (err as Error).message, severity: 'error' }],
                  warnings: [],
                  fields: 0,
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }
    },
  });
}
