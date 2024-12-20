const eslint = require("@eslint/js");
const tseslint = require("@typescript-eslint/eslint-plugin");
const tsparser = require("@typescript-eslint/parser");
const unusedImports = require("eslint-plugin-unused-imports");

module.exports = [
  {
    ignores: [
      "**/node_modules/**/*",
      "**/dist/**/*",
    ]
  },
  // JavaScript files configuration
  {
    files: ["**/*.js"],
    ...eslint.configs.recommended,
    languageOptions: {
      ecmaVersion: 2018,
      sourceType: "module",
      globals: {
        node: true
      }
    },
    plugins: {
      "unused-imports": unusedImports
    },
    rules: {
      "indent": ["error", 2, {
        "SwitchCase": 1,
      }],
      "no-unused-vars": "off",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn", {
          "vars": "all",
          "args": "after-used",
          "ignoreRestSiblings": true,
        }
      ],
      "quotes": ["error", "double", {
        "avoidEscape": true,
        "allowTemplateLiterals": true,
      }],
      "linebreak-style": ["error", "unix"],
      "eol-last": ["error", "always"],
      "semi": ["error", "always"],
      "object-shorthand": "error",
      "prefer-template": "error",
      "template-curly-spacing": "error",
      "padding-line-between-statements": [
        "error",
        { "blankLine": "always", "prev": "*", "next": "return" },
        { "blankLine": "always", "prev": "*", "next": "block-like" },
        { "blankLine": "always", "prev": "*", "next": "function" },
        { "blankLine": "always", "prev": "*", "next": "class" },
        { "blankLine": "always", "prev": ["const", "let", "var"], "next": "*" },
        { "blankLine": "any", "prev": ["const", "let", "var"], "next": ["const", "let", "var"]},
      ]
    }
  },
  // TypeScript files configuration
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2018,
        sourceType: "module"
      }
    },
    plugins: {
      "@typescript-eslint": tseslint,
      "unused-imports": unusedImports
    },
    rules: {
      "semi": "off",
      "semi-spacing": "off",
      "semi-style": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/ban-types": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-empty-interface": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn", {
          "vars": "all",
          "args": "after-used",
          "ignoreRestSiblings": true,
        }
      ],
      "indent": ["error", 2, {
        "SwitchCase": 1,
      }],
      "quotes": ["error", "double", {
        "avoidEscape": true,
        "allowTemplateLiterals": true,
      }],
      "linebreak-style": ["error", "unix"],
      "eol-last": ["error", "always"],
      "object-shorthand": "error",
      "prefer-template": "error",
      "template-curly-spacing": "error",
      "padding-line-between-statements": [
        "error",
        { "blankLine": "always", "prev": "*", "next": "return" },
        { "blankLine": "always", "prev": "*", "next": "block-like" },
        { "blankLine": "always", "prev": "*", "next": "function" },
        { "blankLine": "always", "prev": "*", "next": "class" },
        { "blankLine": "always", "prev": ["const", "let", "var"], "next": "*" },
        { "blankLine": "any", "prev": ["const", "let", "var"], "next": ["const", "let", "var"]},
      ]
    }
  }
];
