import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // 只影响开发期热更新体验, 不影响正确性与生产产物, 降为提醒并在工程规范登记
      'react-refresh/only-export-components': 'warn',
    },
  },
  {
    // 构建配置跑在 Node 侧, 插件接口本身无类型, 允许 any
    files: ['vite.config.ts', '*.config.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
])
