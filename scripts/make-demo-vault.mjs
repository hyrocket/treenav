/**
 * Builds the vault used for screenshots and video.
 *
 *   node scripts/make-demo-vault.mjs                 -> demo-vault
 *   node scripts/make-demo-vault.mjs --out somewhere
 *
 * Everything TreeNav does should be visible the moment the vault opens: folder
 * notes, a note that has adopted children, a hand-set order, emoji icons,
 * colours, a highlight, the classic tree. That is why the plugin's own data and
 * a workspace layout are written alongside the notes rather than left to be set
 * up by hand each time.
 *
 * The vault is disposable and not tracked in git; this script is.
 */
import { mkdir, writeFile, rm, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const out = resolve(argValue("--out") ?? "demo-vault");

/** The note opened in the middle pane, and the tree's own showpiece. */
const OPENED = "Space missions/Mars/Perseverance rover.md";

/**
 * The tree, in order. "Name/Name.md" is a folder note, which is why several
 * paths repeat their folder's name.
 */
const NOTES = {
	"Space missions/Space missions.md": [
		"# Space missions",
		"",
		"Probes and crewed programmes. This note shares its folder's name, so",
		"clicking the folder opens it — and it stays out of the listing.",
	],
	"Space missions/Mars/Mars.md": [
		"# Mars",
		"",
		"A day lasts 24h 37m, close enough to Earth's to be eerie. The atmosphere",
		"is not: 0.6% of Earth's pressure.",
	],
	"Space missions/Mars/Perseverance rover.md": [
		"# Perseverance rover",
		"",
		"Landed in Jezero crater in February 2021, on what was a river delta three",
		"and a half billion years ago.",
		"",
		"It drills, seals and sets down tubes of rock for a later mission to pick",
		"up — see [[Sample return]]. Thirty-odd tubes are already waiting on the",
		"surface, which is a strange kind of optimism.",
	],
	"Space missions/Mars/Sample return.md": [
		"# Sample return",
		"",
		"A lander, an ascent vehicle and an orbiter all have to work, in that",
		"order. That combination has never been flown.",
	],
	"Space missions/Mars/Atmosphere and terraforming.md": [
		"# Atmosphere and terraforming",
		"",
		"95% carbon dioxide, and no magnetic field to keep the solar wind from",
		"stripping it away. Every terraforming argument stalls here.",
	],
	"Space missions/Jupiter system/Jupiter system.md": [
		"# Jupiter system",
		"",
		"More than ninety moons; the four Galilean ones amount to a small solar",
		"system of their own.",
	],
	"Space missions/Jupiter system/Europa's ocean.md": [
		"# Europa's ocean",
		"",
		"A liquid ocean perhaps 100km deep under the ice — more water than all of",
		"Earth's seas together.",
	],
	"Space missions/Jupiter system/Ganymede.md": [
		"# Ganymede",
		"",
		"The largest moon in the solar system, bigger than Mercury, and the only",
		"one with a magnetic field of its own.",
	],
	"Space missions/Voyager/Voyager 1.md": [
		"# Voyager 1",
		"",
		"Launched 1977, interstellar since 2012. The most distant human object; a",
		"signal takes over twenty-two hours to arrive.",
	],
	"Space missions/Voyager/Voyager 2.md": [
		"# Voyager 2",
		"",
		"The only craft to have flown past Uranus and Neptune, on an alignment",
		"that comes round once every 176 years.",
	],
	"Space missions/Voyager/Golden record.md": [
		"# Golden record",
		"",
		"Greetings in 55 languages, the sounds of Earth, 116 images. Expected to",
		"last on the order of a billion years.",
	],

	"Astrophysics/Astrophysics.md": [
		"# Astrophysics",
		"",
		"What has been observed, kept apart from what is still a model.",
	],
	"Astrophysics/Black holes/Black holes.md": [
		"# Black holes",
		"",
		"Described completely by mass, charge and angular momentum — the no-hair",
		"theorem, and one of the shortest descriptions in physics.",
	],
	"Astrophysics/Black holes/Event horizon.md": [
		"# Event horizon",
		"",
		"The boundary of no return. For one solar mass it is about three",
		"kilometres across.",
	],
	"Astrophysics/Black holes/First image, M87.md": [
		"# First image, M87",
		"",
		"2019, from an Earth-sized virtual telescope. Six and a half billion solar",
		"masses, and a shadow the size of our solar system.",
	],
	"Astrophysics/Black holes/Hawking radiation.md": [
		"# Hawking radiation",
		"",
		"A prediction that black holes evaporate, very slowly. Never observed.",
	],
	"Astrophysics/Neutron stars/Neutron stars.md": [
		"# Neutron stars",
		"",
		"A sugar cube of this weighs a billion tonnes.",
		"",
		"This started as an ordinary note and became a folder by adopting the two",
		"below it. Pull the last one back out and it turns into a note again.",
	],
	"Astrophysics/Neutron stars/Pulsars.md": [
		"# Pulsars",
		"",
		"Rotating neutron stars beating in radio. The first was catalogued LGM-1,",
		"for little green men.",
	],
	"Astrophysics/Neutron stars/Magnetars.md": [
		"# Magnetars",
		"",
		"Magnetic fields a quadrillion times Earth's — able to wipe a credit card",
		"from a thousand kilometres away.",
	],
	"Astrophysics/Gravitational waves/LIGO.md": [
		"# LIGO",
		"",
		"Two interferometers with four-kilometre arms, measuring a change one",
		"ten-thousandth the width of a proton.",
	],
	"Astrophysics/Gravitational waves/GW150914.md": [
		"# GW150914",
		"",
		"14 September 2015, the first detection. Black holes of 36 and 29 solar",
		"masses merged, and three solar masses left as energy.",
	],

	"Rockets/Rockets.md": ["# Rockets", "", "Launchers, and how they push."],
	"Rockets/Reusable launchers/Reusable launchers.md": [
		"# Reusable launchers",
		"",
		"Recovering the first stage took cost per kilogram down by most of an",
		"order of magnitude.",
	],
	"Rockets/Reusable launchers/Falcon 9.md": [
		"# Falcon 9",
		"",
		"The first launcher to make recovery routine; single boosters have flown",
		"more than twenty times.",
	],
	"Rockets/Reusable launchers/Starship.md": [
		"# Starship",
		"",
		"Two stages, both meant to come back. Stainless steel and methane, which",
		"is an unusual pair of choices.",
	],
	"Rockets/Nuri.md": [
		"# Nuri",
		"",
		"South Korea's three-stage liquid launcher. The second flight, June 2022,",
		"put its payload in the intended orbit.",
	],
	"Rockets/Propulsion compared.md": [
		"# Propulsion compared",
		"",
		"| Kind | Specific impulse | Thrust |",
		"|---|---|---|",
		"| Solid | Low | Enormous |",
		"| Kerosene and LOX | Middling | Large |",
		"| Ion | Very high | Tiny |",
		"",
		"Ion drives push about as hard as a sheet of paper resting on your hand,",
		"and keep doing it for years.",
	],

	"Observing log/Observing log.md": [
		"# Observing log",
		"",
		"By date, with the sky and the kit noted alongside.",
	],
	"Observing log/2026-03 Mars at opposition.md": [
		"# 2026-03 Mars at opposition",
		"",
		"13.9 arcseconds. Polar cap sharp, seeing 5/10, best around midnight.",
	],
	"Observing log/2026-05 Io transit.md": [
		"# 2026-05 Io transit",
		"",
		"Io crossed the disc and dropped its shadow ahead of it. Started 22:41.",
	],
	"Observing log/Equipment.md": [
		"# Equipment",
		"",
		"Mirror cleaning, collimation records, polar alignment notes.",
	],
	"Observing log/Sites.md": [
		"# Sites",
		"",
		"Bortle class next to how long it takes to get there. In winter the drive",
		"decides it.",
	],

	"Reference/Glossary.md": [
		"# Glossary",
		"",
		"Light year · parallax · right ascension · magnitude · delta-v.",
	],
	"Reference/Bibliography.md": ["# Bibliography", "", "Textbooks and papers."],
	"Reference/Image list.txt": [
		"Not a markdown file.",
		"Turn on 'Show non-markdown files' to see it in the tree.",
	],

	"To read.md": [
		"# To read",
		"",
		"- First Europa Clipper results",
		"- JWST early galaxies paper",
		"- Nuri flight 4 schedule",
	],
};

/** Folders with nothing in them, which the tree draws without an arrow. */
const EMPTY_FOLDERS = ["Reference/Images"];

/** TreeNav's own state, so the vault shows what it can do as soon as it opens. */
const PLUGIN_DATA = {
	version: 1,
	settings: {
		sortMode: "mixed",
		showNonMarkdownFiles: false,
		openFolderNoteOnClick: true,
		autoCreateFolderNote: true,
		hideFolderNoteFiles: true,
		rememberExpandedFolders: true,
		revealActiveNote: false,
		confirmDelete: true,
		showDefaultIcons: true,
		treeStyle: "classic",
		flattenNestedFolders: "ask",
	},
	expandedFolders: [
		"Space missions",
		"Space missions/Mars",
		"Astrophysics",
		"Astrophysics/Black holes",
		"Astrophysics/Neutron stars",
		"Rockets",
		"Observing log",
	],
	styles: {
		"Space missions": { icon: "🚀", color: "var(--color-blue)" },
		"Space missions/Mars": { icon: "🔴" },
		"Space missions/Mars/Perseverance rover.md": { icon: "🤖" },
		"Space missions/Jupiter system": { icon: "🪐" },
		"Space missions/Voyager": { icon: "🛰️" },
		Astrophysics: { icon: "🔭", color: "var(--color-purple)" },
		"Astrophysics/Black holes": { icon: "⚫" },
		"Astrophysics/Black holes/First image, M87.md": { icon: "📸" },
		// The note that became a folder, marked so it stands out in a screenshot.
		"Astrophysics/Neutron stars": { icon: "⭐", fontWeight: "bold" },
		"Astrophysics/Gravitational waves": { icon: "〰️" },
		Rockets: { icon: "🛸", color: "var(--color-orange)" },
		"Rockets/Nuri.md": { icon: "🇰🇷", background: "rgba(255, 208, 0, 0.35)" },
		"Observing log": { icon: "📓", color: "var(--color-green)" },
		"Observing log/2026-03 Mars at opposition.md": { background: "rgba(0, 200, 83, 0.28)" },
		Reference: { icon: "📚", color: "var(--text-muted)" },
		"To read.md": { icon: "📌", fontStyle: "italic" },
	},
	// A hand-set order, so the tree is plainly not just alphabetical.
	order: {
		"Space missions": 0,
		Astrophysics: 1,
		Rockets: 2,
		"Observing log": 3,
		Reference: 4,
		"To read.md": 5,
	},
	// The one folder that is really a note that gained children.
	nestedFolders: ["Astrophysics/Neutron stars"],
};

/**
 * A layout with the tree open on the left and one note in the middle.
 *
 * The vault ships plugin data, so the first-run rule that opens the view by
 * itself does not apply here — and a screenshot should not depend on
 * remembering to open the panel.
 */
const WORKSPACE = {
	main: {
		id: "demo-main",
		type: "split",
		direction: "vertical",
		children: [
			{
				id: "demo-tabs",
				type: "tabs",
				children: [
					{
						id: "demo-note",
						type: "leaf",
						state: { type: "markdown", state: { file: OPENED, mode: "source" } },
					},
				],
			},
		],
	},
	left: {
		id: "demo-left",
		type: "split",
		direction: "horizontal",
		width: 320,
		children: [
			{
				id: "demo-left-tabs",
				type: "tabs",
				currentTab: 0,
				children: [{ id: "demo-tree", type: "leaf", state: { type: "treenav-view", state: {} } }],
			},
		],
	},
	right: {
		id: "demo-right",
		type: "split",
		direction: "horizontal",
		width: 300,
		collapsed: true,
		children: [
			{
				id: "demo-right-tabs",
				type: "tabs",
				children: [{ id: "demo-backlink", type: "leaf", state: { type: "backlink", state: {} } }],
			},
		],
	},
	active: "demo-note",
	lastOpenFiles: [OPENED],
};

await rm(out, { recursive: true, force: true });
await scaffold();

for (const [path, lines] of Object.entries(NOTES)) {
	await write(join(out, path), lines.join("\n") + "\n");
}
for (const folder of EMPTY_FOLDERS) {
	await mkdir(join(out, folder), { recursive: true });
}

await writeJson(join(out, ".obsidian", "plugins", "treenav", "data.json"), PLUGIN_DATA);
await writeJson(join(out, ".obsidian", "workspace.json"), WORKSPACE);

console.log(`${Object.keys(NOTES).length} notes -> ${out}`);
console.log("Open that folder as a vault; TreeNav is already set up in it.");

async function write(path, contents) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, contents, "utf8");
}

async function writeJson(path, value) {
	await write(path, JSON.stringify(value, null, 2) + "\n");
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
