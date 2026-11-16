import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
	{ ignores: ["dist/", "coverage/"] },
	js.configs.recommended,
	tseslint.configs.strictTypeChecked,
	{
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: ["eslint.config.js"],
				},
			},
		},
	},
	stylistic.configs.customize({
		indent: "tab",
		quotes: "double",
		semi: true,
		braceStyle: "allman",
		commaDangle: "always-multiline",
		arrowParens: true,
	}),
	{
		rules: {
			"@stylistic/brace-style": ["error", "allman", { allowSingleLine: false }],
			"@typescript-eslint/switch-exhaustiveness-check": "error",
		},
	},
	{
		files: ["**/*.js"],
		extends: [tseslint.configs.disableTypeChecked],
	},
);
