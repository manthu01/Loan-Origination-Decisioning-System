import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

// Deliberately not `next/core-web-vitals` via FlatCompat: bridging that legacy shareable
// config into ESLint's flat config throws "Converting circular structure to JSON" from
// inside @eslint/eslintrc's config-validator (a real incompatibility between FlatCompat
// and eslint-plugin-react's config object as of ESLint 10 / eslint-config-next 16). This
// hand-built flat config covers real correctness rules (TS + react-hooks) without it.
export default [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', '*.config.js', '*.config.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Every data-fetching page here uses the standard "fetch on mount/param change"
      // pattern (setLoading/setError/setData inside a useEffect that calls an async
      // loader) -- correct and idiomatic without a data-fetching library, just not the
      // React-Compiler-era style this rule (new in v7) is steering toward. Not a bug.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
];
