import esbuild from "esbuild";
import process from "process";
import { execFile } from "node:child_process";
import builtins from "builtin-modules";

const banner = `/*
TreeNav - bundled by esbuild. Source: src/
*/
`;

const production = process.argv[2] === "production";

/** In watch mode, push each rebuild straight into the vault under test. */
const deployVault = production ? null : process.env.TREENAV_VAULT ?? "test-vault";

const deployPlugin = {
	name: "treenav-deploy",
	setup(build) {
		build.onEnd((result) => {
			if (!deployVault || result.errors.length > 0) return;
			execFile(process.execPath, ["scripts/deploy.mjs", deployVault], (error, stdout) => {
				console.log(error ? `deploy failed: ${error.message}` : stdout.trim());
			});
		});
	},
};

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: production,
  plugins: [deployPlugin],
});

if (production) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
