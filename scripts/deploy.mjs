/**
 * Copies the built plugin into a vault's plugin folder.
 *
 *   node scripts/deploy.mjs                  -> ./test-vault
 *   node scripts/deploy.mjs "D:/My Vault"    -> that vault
 *   TREENAV_VAULT="D:/My Vault" npm run deploy
 */
import { copyFile, mkdir, access } from "node:fs/promises";
import { join, resolve } from "node:path";

const vault = resolve(process.argv[2] ?? process.env.TREENAV_VAULT ?? "test-vault");
const target = join(vault, ".obsidian", "plugins", "treenav");
const files = ["manifest.json", "main.js", "styles.css"];

try {
	await access(join(vault, ".obsidian"));
} catch {
	console.error(`Not an Obsidian vault (no .obsidian folder): ${vault}`);
	process.exit(1);
}

await mkdir(target, { recursive: true });
for (const file of files) {
	await copyFile(file, join(target, file));
}

console.log(`TreeNav -> ${target}`);
