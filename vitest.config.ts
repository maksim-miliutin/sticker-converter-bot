import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
		environment: "node",
		// grammY on Node loads node-fetch v2, whose URL parser still requires the
		// deprecated punycode module; the warning is not ours to fix.
		execArgv: ["--disable-warning=DEP0040"],
	},
});
