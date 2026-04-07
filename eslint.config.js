import js from '@eslint/js';
import globals from 'globals';
import prettierConfig from 'eslint-config-prettier';
import tsParser from '@typescript-eslint/parser';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig(
    {
        ignores: ['**/dist/**', '**/node_modules/**', '**/legacy/**', '**/bin/**', '**/www/**', '**/public/lib/**'],
    },
    js.configs.recommended,
    prettierConfig,
    tseslint.configs.recommendedTypeChecked,
    {
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                project: './tsconfig-eslint.json',
            },
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.node,
            },
        },
        rules: {
            '@typescript-eslint/no-unused-vars': [
                'warn',
                {
                    args: 'all',
                    argsIgnorePattern: '^_',
                    caughtErrors: 'all',
                    caughtErrorsIgnorePattern: '^_',
                    destructuredArrayIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    ignoreRestSiblings: true,
                },
            ],
            'no-console': ['warn', { allow: ['log', 'warn', 'error', 'debug', 'trace', 'time', 'timeEnd'] }],
            'no-empty': ['error', { allowEmptyCatch: true }],
            'no-async-promise-executor': 'warn',
            '@typescript-eslint/await-thenable': 'error',
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-misused-promises': 'off',
            '@typescript-eslint/require-await': 'off',
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-namespace': 'off',
        },
    },
    {
        files: ['**/*.js'],
        rules: {
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-argument': 'off',
            '@typescript-eslint/no-unsafe-return': 'off',
            '@typescript-eslint/prefer-promise-reject-errors': 'off',
        },
    }
);
