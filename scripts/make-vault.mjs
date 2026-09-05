/**
 * Writes a large vault to disk, for measuring TreeNav in the real app.
 *
 *   node scripts/make-vault.mjs                      -> bench-vault, 5000 notes
 *   node scripts/make-vault.mjs --files 20000        -> bigger
 *   node scripts/make-vault.mjs --out big --files 50 -> somewhere else
 *
 * The harness measures the same shape in jsdom, which is enough to see whether
 * a cost follows the file count or the square of it. It cannot say what the
 * browser Obsidian runs on will do with the same DOM, and that is what this is
 * for: open the folder as a vault and watch it.
 *
 * The vault is disposable and not tracked in git.
 */
import { mkdir, writeFile, rm, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const out = resolve(argValue("--out") ?? "bench-vault");
const files = Number(argValue("--files") ?? 5000);
const keep = process.argv.includes("--keep");

if (!Number.isFinite(files) || files < 1) {
	console.error("--files needs a number");
	process.exit(1);
}

// The shape a vault of this size tends to have: a few dozen areas, three levels
// deep, an even spread of notes at the bottom. Deliberately not one flat folder,
// which would measure something no one has.
const TOP = 24;
const MID = 4;
const SUB = 3;
const perLeaf = Math.max(1, Math.ceil(files / (TOP * MID * SUB)));

if (!keep) {
	// Everything but .obsidian, so the vault stays trusted between runs.
	await rm(join(out, "Areas"), { recursive: true, force: true });
	for (let a = 0; a < 200; a += 1) {
		await rm(join(out, `Area ${pad(a)}`), { recursive: true, force: true });
	}
}

await scaffold();

let written = 0;
outer: for (let a = 0; a < TOP; a += 1) {
	const top = `Area ${pad(a)}`;
	await write(join(out, top, `${top}.md`), note(top, "The folder note for this area."));
	written += 1;

	for (let b = 0; b < MID; b += 1) {
		for (let c = 0; c < SUB; c += 1) {
			const leaf = join(out, top, `Project ${pad(b)}`, `Part ${pad(c)}`);
			for (let n = 0; n < perLeaf; n += 1) {
				const name = `Note ${pad(n)} in ${top}`;
				await write(join(leaf, `${name}.md`), note(name, `Part ${pad(c)} of project ${pad(b)}.`));
				written += 1;
				if (written >= files) break outer;
			}
		}
	}
}

console.log(`${written} notes -> ${out}`);
console.log("Open that folder as a vault in Obsidian, then enable TreeNav.");

async function write(path, contents) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, contents, "utf8");
}

function note(title, line) {
	return `# ${title}\n\n${line}\n`;
}

function pad(n) {
	return String(n).padStart(2, "0");
}

/** Enough of a .obsidian for the vault to open trusted with TreeNav enabled. */
async function scaffold() {
	await mkdir(join(out, ".obsidian"), { recursive: true });
	for (const [name, contents] of [
		["community-plugins.json", JSON.stringify(["treenav"])],
		["app.json", "{}"],
	]) {
		const path = join(out, ".obsidian", name);
		try {
			await access(path);
		} catch {
			await writeFile(path, contents, "utf8");
		}
	}
}

function argValue(flag) {
	const index = process.argv.indexOf(flag);
	return index === -1 ? undefined : process.argv[index + 1];
}
