/**
 * Rebuilds the test vault's content to a known fixture.
 *
 *   node scripts/reset-test-vault.mjs              -> reset content, keep plugin state
 *   node scripts/reset-test-vault.mjs --wipe-state -> also drop TreeNav's data.json
 *
 * `.obsidian` is preserved so the vault stays trusted and the plugin stays
 * installed; only notes and folders are recreated.
 */
import { readdir, rm, mkdir, writeFile, access } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";

const vault = resolve(process.argv.find((a) => !a.startsWith("--") && a !== process.argv[0] && a !== process.argv[1]) ?? "test-vault");
const wipeState = process.argv.includes("--wipe-state");

/** path -> file contents. Folders are created from the paths. */
const FIXTURE = {
	"Welcome.md": "# Welcome\n\nTreeNav test vault. Reset with `npm run reset`.\n",

	// Folder note cases
	"Projects/Projects.md": "# Projects\n\nFolder note for Projects.\n",
	"Projects/Sixtoms/Planning.md": "# Planning\n\nLink target: [[Marketing]]\n",
	"Projects/Sixtoms/Marketing.md": "# Marketing\n\nLinked from [[Planning]].\n",
	"Projects/RE100/Meeting.md": "# Meeting\n",
	"Ideas/Ideas.md": "# Ideas\n\nFolder note for Ideas.\n",
	"Ideas/AI/Prompt engineering.md": "# Prompt engineering\n",
	"Ideas/Commerce/Storefront.md": "# Storefront\n",

	// No folder note anywhere in this branch, and a deep nesting to expand
	"Archive/2024/Q1/Old note.md": "# Old note\n",
	"Archive/2024/Q2/Newer note.md": "# Newer note\n",

	// Rename-conflict fixture: renaming "Alpha/Alpha.md" to "Beta" must be refused
	"Alpha/Alpha.md": "# Alpha\n\nFolder note. Renaming this to `Beta` must be refused.\n",
	"Beta/Beta.md": "# Beta\n\nFolder note.\n",

	// Naming edge cases
	"한글 노트.md": "# 한글 노트\n",
	"A very long note name used to check that the title is truncated with an ellipsis.md":
		"# Long name\n",
	"attachment.txt": "Not markdown. Hidden unless 'Show non-markdown files' is on.\n",
};

/** Folders that exist with no files in them. */
const EMPTY_FOLDERS = ["빈 폴더", "Archive/2023"];

// The vault is disposable and not tracked in git, so recreate the scaffold that
// makes Obsidian treat the folder as a trusted vault with TreeNav enabled.
await mkdir(join(vault, ".obsidian"), { recursive: true });
for (const [name, contents] of [
	["community-plugins.json", JSON.stringify(["treenav"])],
	["app.json", "{}"],
]) {
	const path = join(vault, ".obsidian", name);
	try {
		await access(path);
	} catch {
		await writeFile(path, contents, "utf8");
	}
}

const entries = await readdir(vault, { withFileTypes: true });
for (const entry of entries) {
	if (entry.name === ".obsidian") continue;
	await rm(join(vault, entry.name), { recursive: true, force: true });
}

for (const [path, contents] of Object.entries(FIXTURE)) {
	const target = join(vault, path);
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, contents, "utf8");
}

for (const folder of EMPTY_FOLDERS) {
	await mkdir(join(vault, folder), { recursive: true });
}

if (wipeState) {
	await rm(join(vault, ".obsidian", "plugins", "treenav", "data.json"), { force: true });
	await rm(join(vault, ".obsidian", "workspace.json"), { force: true });
}

console.log(`Reset ${vault}${wipeState ? " (plugin state and workspace cleared)" : ""}`);
console.log("Reload Obsidian to pick the changes up: Ctrl+P -> Reload app without saving");
