/**
 * fs_component_scaffold — Ianus Liminalis
 *
 * Genera scaffolding per componenti frontend (React, Vue, Svelte, Solid)
 * con template predefiniti, supporto TypeScript e file extra (test, story, types).
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

type Framework = 'react' | 'vue' | 'svelte' | 'solid';
type ExtraInclude = 'styles' | 'test' | 'story' | 'types';

const VALID_FRAMEWORKS: Framework[] = ['react', 'vue', 'svelte', 'solid'];
const VALID_INCLUDES: ExtraInclude[] = ['styles', 'test', 'story', 'types'];

interface ScaffoldResult {
  name: string;
  framework: string;
  files: string[];
  baseDir: string;
}

// ────────────────────────────────────────────────────────────
// Template generators
// ────────────────────────────────────────────────────────────

function toPascalCase(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, chr) => chr.toUpperCase())
    .replace(/^(.)/, (chr) => chr.toUpperCase());
}

function toCamelCase(name: string): string {
  const pascal = toPascalCase(name);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/**
 * Genera il contenuto di un componente React (TSX)
 */
function generateReactComponent(componentName: string): string {
  const pascalName = toPascalCase(componentName);

  return `import type { FC } from 'react';

export interface ${pascalName}Props {
  /** Primary content */
  children?: React.ReactNode;
  /** Additional CSS classes */
  className?: string;
}

const ${pascalName}: FC<${pascalName}Props> = ({ children, className }) => {
  return (
    <div className={className}>
      {children}
    </div>
  );
};

export default ${pascalName};
`;
}

/**
 * Genera il contenuto di un componente Solid (TSX)
 */
function generateSolidComponent(componentName: string): string {
  const pascalName = toPascalCase(componentName);

  return `import type { Component, JSX } from 'solid-js';

export interface ${pascalName}Props {
  children?: JSX.Element;
  class?: string;
}

const ${pascalName}: Component<${pascalName}Props> = (props) => {
  return (
    <div class={props.class}>
      {props.children}
    </div>
  );
};

export default ${pascalName};
`;
}

/**
 * Genera il contenuto di un componente Vue SFC
 */
function generateVueComponent(componentName: string): string {
  const pascalName = toPascalCase(componentName);

  return `<template>
  <div class="${toCamelCase(componentName)}">
    <slot />
  </div>
</template>

<script setup lang="ts">
export interface ${pascalName}Props {
  /** Additional CSS classes */
  className?: string;
}

withDefaults(defineProps<${pascalName}Props>(), {
  className: '',
});
</script>

<style scoped>
.${toCamelCase(componentName)} {
  /* Component styles */
}
</style>
`;
}

/**
 * Genera il contenuto di un componente Svelte
 */
function generateSvelteComponent(componentName: string): string {
  const pascalName = toPascalCase(componentName);

  return `<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let className: string = '';

  const dispatch = createEventDispatcher<{
    click: MouseEvent;
  }>();
</script>

<div class={className} on:click>
  <slot />
</div>

<style>
  /* Component styles */
</style>
`;
}

/**
 * Genera il contenuto del file CSS Module per React/Solid
 */
function generateCssModule(componentName: string): string {
  const camelName = toCamelCase(componentName);

  return `.${camelName} {
  /* ${componentName} styles */
}
`;
}

/**
 * Genera il contenuto del file styles.ts (stile oggetto/emotion)
 */
function generateStylesTs(componentName: string): string {
  const pascalName = toPascalCase(componentName);

  return `import type { CSSProperties } from 'react';

export const styles: Record<string, CSSProperties> = {
  root: {
    /* ${pascalName} styles */
  },
};
`;
}

/**
 * Genera il contenuto del file di test
 */
function generateTestFile(
  componentName: string,
  framework: Framework,
): string {
  const pascalName = toPascalCase(componentName);

  switch (framework) {
    case 'react':
      return `import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ${pascalName} from './${pascalName}';

describe('${pascalName}', () => {
  it('renders without crashing', () => {
    const { container } = render(<${pascalName}>Test</${pascalName}>);
    expect(container).toBeTruthy();
  });

  it('renders children correctly', () => {
    render(<${pascalName}>Hello World</${pascalName}>);
    expect(screen.getByText('Hello World')).toBeDefined();
  });
});
`;
    case 'vue':
      return `import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ${pascalName} from './${pascalName}.vue';

describe('${pascalName}', () => {
  it('renders without crashing', () => {
    const wrapper = mount(${pascalName});
    expect(wrapper.exists()).toBe(true);
  });
});
`;
    case 'svelte':
      return `import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ${pascalName} from './${pascalName}.svelte';

describe('${pascalName}', () => {
  it('renders without crashing', () => {
    const { container } = render(${pascalName});
    expect(container).toBeTruthy();
  });
});
`;
    case 'solid':
      return `import { describe, it, expect } from 'vitest';
import { render, screen } from 'solid-testing-library';
import ${pascalName} from './${pascalName}';

describe('${pascalName}', () => {
  it('renders without crashing', () => {
    const { container } = render(() => <${pascalName}>Test</${pascalName}>);
    expect(container).toBeTruthy();
  });
});
`;
  }
}

/**
 * Genera il contenuto del file Storybook
 */
function generateStoryFile(
  componentName: string,
  framework: Framework,
): string {
  const pascalName = toPascalCase(componentName);

  const metaType = framework === 'vue' ? { component: pascalName } : { component: pascalName };

  const meta = JSON.stringify(metaType, null, 2).replace(/"component": "(\w+)"/, `component: ${pascalName}`);

  return `import type { Meta, StoryObj } from 'storybook-framework';
import ${pascalName} from './${pascalName}${framework === 'vue' ? '.vue' : ''}';

const meta = {
  title: 'Components/${pascalName}',
  component: ${pascalName},
  tags: ['autodocs'],
} satisfies Meta<typeof ${pascalName}>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: '${pascalName} Component',
  },
};
`;
}

/**
 * Genera il contenuto del file index.ts per re-export
 */
function generateIndexFile(
  componentName: string,
  framework: Framework,
  useTypescript: boolean,
): string {
  const pascalName = toPascalCase(componentName);
  const ext = useTypescript ? '.ts' : '.js';

  const exportStatement =
    framework === 'vue'
      ? `export { default as ${pascalName} } from './${pascalName}.vue';\n`
      : framework === 'svelte'
        ? `export { default as ${pascalName} } from './${pascalName}.svelte';\n`
        : `export { default as ${pascalName} } from './${pascalName}';\n`;

  const typeExport =
    useTypescript && framework !== 'vue' && framework !== 'svelte'
      ? `export type { ${pascalName}Props } from './${pascalName}';\n`
      : '';

  return `${exportStatement}${typeExport}`;
}

// ────────────────────────────────────────────────────────────
// Scaffold builder
// ────────────────────────────────────────────────────────────

interface FileDescriptor {
  relativePath: string;
  content: string;
}

function buildScaffoldFiles(
  componentName: string,
  framework: Framework,
  include: ExtraInclude[],
  useTypescript: boolean,
): FileDescriptor[] {
  const pascalName = toPascalCase(componentName);
  const files: FileDescriptor[] = [];

  const ext = useTypescript ? 'tsx' : 'jsx';
  const testExt = useTypescript ? 'ts' : 'js';

  switch (framework) {
    case 'react':
    case 'solid': {
      const componentExt = framework === 'react' ? ext : useTypescript ? 'tsx' : 'jsx';
      files.push({
        relativePath: `${pascalName}.${componentExt}`,
        content:
          framework === 'solid'
            ? generateSolidComponent(pascalName)
            : generateReactComponent(pascalName),
      });

      if (include.includes('styles')) {
        if (useTypescript && include.includes('types')) {
          // Se types è incluso, usa styles.ts
          files.push({
            relativePath: `${pascalName}.styles.${useTypescript ? 'ts' : 'js'}`,
            content: generateStylesTs(pascalName),
          });
        } else {
          files.push({
            relativePath: `${pascalName}.module.css`,
            content: generateCssModule(pascalName),
          });
        }
      }

      if (include.includes('test')) {
        files.push({
          relativePath: `${pascalName}.test.${testExt}x`,
          content: generateTestFile(pascalName, framework),
        });
      }

      if (include.includes('story')) {
        files.push({
          relativePath: `${pascalName}.stories.${componentExt}`,
          content: generateStoryFile(pascalName, framework),
        });
      }

      if (include.includes('types')) {
        files.push({
          relativePath: `types.${useTypescript ? 'ts' : 'js'}`,
          content: `export interface ${pascalName}Types {\n  /** Add your types here */\n}\n`,
        });
      }

      files.push({
        relativePath: `index.${useTypescript ? 'ts' : 'js'}`,
        content: generateIndexFile(pascalName, framework, useTypescript),
      });
      break;
    }

    case 'vue': {
      files.push({
        relativePath: `${pascalName}.vue`,
        content: generateVueComponent(pascalName),
      });

      if (include.includes('test')) {
        files.push({
          relativePath: `${pascalName}.test.${testExt}`,
          content: generateTestFile(pascalName, framework),
        });
      }

      if (include.includes('story')) {
        files.push({
          relativePath: `${pascalName}.stories.${testExt}`,
          content: generateStoryFile(pascalName, framework),
        });
      }

      if (include.includes('types')) {
        files.push({
          relativePath: `types.${useTypescript ? 'ts' : 'js'}`,
          content: `export interface ${pascalName}Types {\n  /** Add your types here */\n}\n`,
        });
      }

      files.push({
        relativePath: `index.${useTypescript ? 'ts' : 'js'}`,
        content: generateIndexFile(pascalName, framework, useTypescript),
      });
      break;
    }

    case 'svelte': {
      files.push({
        relativePath: `${pascalName}.svelte`,
        content: generateSvelteComponent(pascalName),
      });

      if (include.includes('styles')) {
        files.push({
          relativePath: `${pascalName}.module.css`,
          content: generateCssModule(pascalName),
        });
      }

      if (include.includes('test')) {
        files.push({
          relativePath: `${pascalName}.test.${testExt}`,
          content: generateTestFile(pascalName, framework),
        });
      }

      if (include.includes('story')) {
        files.push({
          relativePath: `${pascalName}.stories.${testExt}`,
          content: generateStoryFile(pascalName, framework),
        });
      }

      if (include.includes('types')) {
        files.push({
          relativePath: `types.${useTypescript ? 'ts' : 'js'}`,
          content: `export interface ${pascalName}Types {\n  /** Add your types here */\n}\n`,
        });
      }

      files.push({
        relativePath: `index.${useTypescript ? 'ts' : 'js'}`,
        content: generateIndexFile(pascalName, framework, useTypescript),
      });
      break;
    }
  }

  return files;
}

// ────────────────────────────────────────────────────────────
// Tool Registration
// ────────────────────────────────────────────────────────────

export function registerComponentScaffold(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_component_scaffold',
    description:
      'Generate scaffolding for frontend components (React, Vue, Svelte, Solid). ' +
      'Creates component file, CSS modules, tests, Storybook stories, and type definitions. ' +
      'Supports TypeScript by default.',
    annotations: { destructiveHint: true, idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Component name in PascalCase (required)',
        },
        output: {
          type: 'string',
          description: 'Output directory path relative to workspace (required)',
        },
        framework: {
          type: 'string',
          enum: ['react', 'vue', 'svelte', 'solid'],
          default: 'react',
          description: 'Target framework (default: "react")',
        },
        include: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['styles', 'test', 'story', 'types'],
          },
          default: ['styles'],
          description:
            'Extra files to include: styles, test, story, types (default: ["styles"])',
        },
        typescript: {
          type: 'boolean',
          default: true,
          description: 'Use .tsx/.ts extensions (default: true)',
        },
        agent: {
          type: 'string',
          description: 'Nome dell agente chiamante (opzionale, default: "ianus")',
        },
      },
      required: ['name', 'output'],
    },
    handler: async (args) => {
      const componentName = args.name as string | undefined;
      if (!componentName) {
        return {
          content: [{ type: 'text', text: 'Missing required parameter: "name"' }],
          isError: true,
        };
      }

      const outputPath = args.output as string | undefined;
      if (!outputPath) {
        return {
          content: [{ type: 'text', text: 'Missing required parameter: "output"' }],
          isError: true,
        };
      }

      const framework = (args.framework as string | undefined) as Framework | undefined;
      const resolvedFramework: Framework =
        framework && VALID_FRAMEWORKS.includes(framework) ? framework : 'react';

      const rawInclude = args.include as string[] | undefined;
      const includeSet = new Set(rawInclude && rawInclude.length > 0 ? rawInclude : ['styles']);
      const include: ExtraInclude[] = VALID_INCLUDES.filter((i) => includeSet.has(i));

      const useTypescript = (args.typescript as boolean | undefined) ?? true;

      const callerAgent = (args.agent as string) || 'ianus';

      // Permission check
      const permCheck = await deps.permission.checkOperation(
        callerAgent,
        'write',
        outputPath,
        deps.workspaceRoot,
      );
      if (!permCheck.allowed) {
        return {
          content: [{ type: 'text', text: `Permission denied: ${permCheck.reason}` }],
          isError: true,
        };
      }

      try {
        const safeOutput = resolveSafePath(outputPath, deps.workspaceRoot);
        const componentDir = join(safeOutput, toPascalCase(componentName));

        // Genera i file dello scaffold
        const files = buildScaffoldFiles(componentName, resolvedFramework, include, useTypescript);

        // Crea directory del componente e scrivi i file
        const createdFiles: string[] = [];

        // Crea la directory di base
        await mkdir(componentDir, { recursive: true });

        for (const file of files) {
          const filePath = join(componentDir, file.relativePath);

          // Crea le subdirectory se necessarie
          await mkdir(dirname(filePath), { recursive: true });

          await writeFile(filePath, file.content, 'utf-8');

          const relPath = join(outputPath, toPascalCase(componentName), file.relativePath)
            .replace(/\\/g, '/');
          createdFiles.push(relPath);
        }

        const result: ScaffoldResult = {
          name: toPascalCase(componentName),
          framework: resolvedFramework,
          files: createdFiles.sort(),
          baseDir: join(outputPath, toPascalCase(componentName)).replace(/\\/g, '/'),
        };

        // Log to journal
        await logToJournal(deps.workspaceRoot, {
          agent: 'ianus',
          operation: 'component_scaffold',
          path: result.baseDir,
          details: {
            componentName: result.name,
            framework: resolvedFramework,
            filesCreated: createdFiles.length,
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
              text: `Error scaffolding component: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  });
}
