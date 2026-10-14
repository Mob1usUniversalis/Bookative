import globals from 'globals';
export default [
  {
    files: ['src/**/*.js'],
    ignores: ['src/gen/**'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.browser } },
    rules: { 'no-unused-vars': ['warn', { args: 'none' }], 'no-undef': 'error' },
  },
];
