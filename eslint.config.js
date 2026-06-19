// eslint.config.js — Root ESLint v10 flat config
// Carthago delenda est — re-esporta la config di tabularium/
// aggiungendo ignores per gli altri progetti del monorepo.
//
// Le import (@eslint/js, typescript-eslint) vengono risolte
// da tabularium/node_modules/ grazie al re-export via ESM.
import tabConfig from './tabularium/eslint.config.mjs';

const rootConfig = Array.isArray(tabConfig) ? tabConfig : [tabConfig];

export default [
  ...rootConfig,
  {
    ignores: [
      // Altri progetti del monorepo — ognuno ha il proprio ESLint config
      'ianus-liminalis/**',
      'arae/**',
      'imago/**',
      'nuntius/**',
      'dashboard/**',
            'speculum/**',
      'speculum-search/**',
      'packages/**',
      'docs/**',
      'scripts/**',
      'templates/**',
      'thesaurus/**',
      // Root level files
      '*.ps1',
      '*.bat',
      '*.txt',
      '*.json',
      '*.md',
    ],
  },
];
