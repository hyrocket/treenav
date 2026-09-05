/**
 * Renders the built plugin against a stubbed Obsidian API and a fake vault, so
 * load-time and render-time breakage is caught here instead of in the app.
 *
 *   npm run smoke
 *
 * The stub implements only what TreeNav actually touches. When a test fails
 * with "x is not a function", the honest fix is usually to widen the stub —
 * unless the plugin is calling something Obsidian does not have either.
 */
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);

// --- DOM ---------------------------------------------------------------------

const dom = new JSDOM("<!doctype html><body></body>");
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
globalThis.Node = window.Node;
globalThis.HTMLElement = window.HTMLElement;
globalThis.HTMLInputElement = window.HTMLInputElement;
globalThis.requestAnimationFrame = (cb) => window.setTimeout(() => cb(0), 0);
globalThis.cancelAnimationFrame = (id) => window.clearTimeout(id);
window.requestAnimationFrame = globalThis.requestAnimationFrame;
window.cancelAnimationFrame = globalThis.cancelAnimationFrame;

/** Obsidian adds these helpers to every element; the plugin relies on them. */
function installDomHelpers(proto) {
	const build = (tag, opts = {}) => {
		const el = document.createElement(tag);
		if (opts.cls) el.className = Array.isArray(opts.cls) ? opts.cls.join(" ") : opts.cls;
		if (opts.text) el.textContent = opts.text;
		if (opts.type) el.setAttribute("type", opts.type);
		return el;
	};

	Object.assign(proto, {
		createDiv(opts) {
			const el = build("div", opts);
			this.appendChild(el);
			return el;
		},
		createEl(tag, opts) {
			const el = build(tag, opts);
			this.appendChild(el);
			return el;
		},
		createSpan(opts) {
			return this.createEl("span", opts);
		},
		empty() {
			while (this.firstChild) this.removeChild(this.firstChild);
		},
		detach() {
			this.remove();
		},
		addClass(...cls) {
			this.classList.add(...cls.filter(Boolean));
		},
		removeClass(...cls) {
			this.classList.remove(...cls.filter(Boolean));
		},
		toggleClass(cls, on) {
			this.classList.toggle(cls, on);
		},
		hasClass(cls) {
			return this.classList.contains(cls);
		},
		setText(text) {
			this.textContent = text;
		},
		getText() {
			return this.textContent;
		},
		scrollIntoView() {},
	});
}
installDomHelpers(window.HTMLElement.prototype);

// --- Obsidian stub -----------------------------------------------------------

class TAbstractFile {
	constructor(path, parent = null) {
		this.path = path;
		this.parent = parent;
		this.name = path.slice(path.lastIndexOf("/") + 1);
	}
}
class TFile extends TAbstractFile {
	constructor(path, parent) {
		super(path, parent);
		const dot = this.name.lastIndexOf(".");
		this.basename = dot > 0 ? this.name.slice(0, dot) : this.name;
		this.extension = dot > 0 ? this.name.slice(dot + 1) : "";
	}
}
class TFolder extends TAbstractFile {
	constructor(path, parent) {
		super(path, parent);
		this.children = [];
	}
	isRoot() {
		return this.path === "/";
	}
}

class Component {
	registerEvent() {}
	registerDomEvent() {}
	registerInterval() {}
	register() {}
	addChild(c) {
		return c;
	}
}
class View extends Component {
	constructor(leaf) {
		super();
		this.leaf = leaf;
		this.app = leaf.app;
		this.containerEl = document.createElement("div");
		this.containerEl.appendChild(document.createElement("div"));
		this.containerEl.appendChild(document.createElement("div"));
	}
}
class ItemView extends View {}
class Modal {
	constructor(app) {
		this.app = app;
		this.contentEl = document.createElement("div");
		this.titleEl = document.createElement("div");
	}
	open() {}
	close() {}
}
class FuzzySuggestModal extends Modal {
	setPlaceholder() {}
}
class Menu {
	addItem(cb) {
		cb({
			setTitle() {
				return this;
			},
			setIcon() {
				return this;
			},
			onClick() {
				return this;
			},
		});
		return this;
	}
	addSeparator() {
		return this;
	}
	showAtMouseEvent() {}
}
class PluginSettingTab {
	constructor(app) {
		this.app = app;
		this.containerEl = document.createElement("div");
	}
}
class Plugin extends Component {
	constructor(app) {
		super();
		this.app = app;
		this.data = null;
	}
	registerView(type, factory) {
		this.app.__viewFactories.set(type, factory);
	}
	addSettingTab() {}
	addRibbonIcon() {
		return document.createElement("div");
	}
	addCommand() {}
	async loadData() {
		return this.data;
	}
	async saveData(data) {
		this.data = data;
	}
}

const obsidianStub = {
	TAbstractFile,
	TFile,
	TFolder,
	Component,
	View,
	ItemView,
	Modal,
	FuzzySuggestModal,
	SuggestModal: FuzzySuggestModal,
	Menu,
	Plugin,
	PluginSettingTab,
	Notice: class {
		constructor(message) {
			notices.push(String(message));
		}
	},
	Setting: class {
		constructor(containerEl) {
			this.containerEl = containerEl;
		}
		setName() {
			return this;
		}
		setDesc() {
			return this;
		}
		setHeading() {
			return this;
		}
		addToggle(cb) {
			cb({ setValue: () => ({ onChange: () => {} }) });
			return this;
		}
		addDropdown(cb) {
			cb({ addOptions: () => ({ setValue: () => ({ onChange: () => {} }) }) });
			return this;
		}
		addButton(cb) {
			cb({
				setButtonText: () => ({ setWarning: () => ({ onClick: () => {} }), onClick: () => {}, setCta: () => ({ onClick: () => {} }) }),
			});
			return this;
		}
		addSlider() {
			return this;
		}
		addExtraButton() {
			return this;
		}
		addColorPicker() {
			return this;
		}
	},
	Platform: { isMacOS: false },
	Keymap: { isModEvent: () => false },
	setIcon: (el, icon) => {
		const svg = document.createElement("span");
		svg.className = "svg-icon";
		svg.setAttribute("data-icon", icon);
		el.appendChild(svg);
	},
	getIconIds: () => ["lucide-folder", "lucide-file"],
	normalizePath: (p) => p,
	debounce: (cb) => {
		const fn = (...args) => cb(...args);
		fn.cancel = () => {};
		return fn;
	},
};

const notices = [];

const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
	if (request === "obsidian") return obsidianStub;
	return originalLoad.call(this, request, ...rest);
};

// --- Fake vault --------------------------------------------------------------

function buildVault(spec) {
	const root = new TFolder("/", null);
	const folders = new Map([["/", root]]);
	const byPath = new Map([["/", root]]);

	const folderFor = (path) => {
		if (path === "") return root;
		let folder = folders.get(path);
		if (folder) return folder;
		const slash = path.lastIndexOf("/");
		const parent = folderFor(slash === -1 ? "" : path.slice(0, slash));
		folder = new TFolder(path, parent);
		parent.children.push(folder);
		folders.set(path, folder);
		byPath.set(path, folder);
		return folder;
	};

	for (const path of spec) {
		if (path.endsWith("/")) {
			folderFor(path.slice(0, -1));
			continue;
		}
		const slash = path.lastIndexOf("/");
		const parent = folderFor(slash === -1 ? "" : path.slice(0, slash));
		const file = new TFile(path, parent);
		parent.children.push(file);
		byPath.set(path, file);
	}

	return { root, byPath };
}

/** Mirrors a real vault directory so persisted state can be replayed against it. */
function scanVault(dir, prefix = "") {
	const out = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === ".obsidian") continue;
		const path = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			const nested = scanVault(join(dir, entry.name), path);
			if (nested.length === 0) out.push(`${path}/`);
			else out.push(...nested);
		} else {
			out.push(path);
		}
	}
	return out.filter(Boolean);
}

const vaultArg = argValue("--vault");
const dataArg = argValue("--data");

const spec = vaultArg
	? scanVault(vaultArg)
	: [
			"Welcome.md",
			"Projects/Projects.md",
			"Projects/Sixtoms/Sixtoms.md",
			"Projects/Sixtoms/Planning.md",
			"Projects/Sixtoms/Marketing.md",
			"Projects/RE100/Meeting.md",
			"Ideas/Ideas.md",
			"Archive/2024/Q1/Old note.md",
			"빈 폴더/",
			"attachment.txt",
		];

const { root, byPath } = buildVault(spec);

function argValue(flag) {
	const index = process.argv.indexOf(flag);
	return index === -1 ? undefined : process.argv[index + 1];
}

/** Enough of a mutable vault to exercise the move / nest operations for real. */
function reparent(file, parent) {
	if (file.parent) {
		const index = file.parent.children.indexOf(file);
		if (index !== -1) file.parent.children.splice(index, 1);
	}
	file.parent = parent;
	parent.children.push(file);
}

function setPath(file, path) {
	const descendants = file instanceof TFolder ? collect(file) : [];
	byPath.delete(file.path);
	const oldPath = file.path;

	file.path = path;
	file.name = path.slice(path.lastIndexOf("/") + 1);
	if (file instanceof TFile) {
		const dot = file.name.lastIndexOf(".");
		file.basename = dot > 0 ? file.name.slice(0, dot) : file.name;
		file.extension = dot > 0 ? file.name.slice(dot + 1) : "";
	}
	byPath.set(path, file);

	for (const child of descendants) {
		const next = path + child.path.slice(oldPath.length);
		byPath.delete(child.path);
		child.path = next;
		byPath.set(next, child);
	}
}

function collect(folder) {
	const out = [];
	for (const child of folder.children) {
		out.push(child);
		if (child instanceof TFolder) out.push(...collect(child));
	}
	return out;
}

function folderAt(path) {
	const existing = byPath.get(path);
	if (existing) return existing;
	const slash = path.lastIndexOf("/");
	const parent = slash === -1 ? root : folderAt(path.slice(0, slash));
	const folder = new TFolder(path, parent);
	parent.children.push(folder);
	byPath.set(path, folder);
	return folder;
}

/**
 * Vault events drive the path migration the plugin depends on, so the fake
 * vault has to emit them the way Obsidian does.
 */
const listeners = new Map();
function on(name, cb) {
	if (!listeners.has(name)) listeners.set(name, []);
	listeners.get(name).push(cb);
	return {};
}
function emit(name, ...args) {
	for (const cb of listeners.get(name) ?? []) cb(...args);
}

const app = {
	__viewFactories: new Map(),
	vault: {
		getRoot: () => root,
		getAbstractFileByPath: (p) => byPath.get(p) ?? null,
		on,
		create: async (path) => {
			const slash = path.lastIndexOf("/");
			const parent = slash === -1 ? root : folderAt(path.slice(0, slash));
			const file = new TFile(path, parent);
			parent.children.push(file);
			byPath.set(path, file);
			emit("create", file);
			return file;
		},
		createFolder: async (path) => {
			const folder = folderAt(path);
			emit("create", folder);
			return folder;
		},
	},
	fileManager: {
		renameFile: async (file, newPath) => {
			const oldPath = file.path;
			const slash = newPath.lastIndexOf("/");
			const parent = slash === -1 ? root : folderAt(newPath.slice(0, slash));
			reparent(file, parent);
			setPath(file, newPath);
			emit("rename", file, oldPath);
		},
		trashFile: async (file) => {
			if (file.parent) {
				const index = file.parent.children.indexOf(file);
				if (index !== -1) file.parent.children.splice(index, 1);
			}
			byPath.delete(file.path);
			if (file instanceof TFolder) {
				for (const child of collect(file)) byPath.delete(child.path);
			}
			emit("delete", file);
		},
	},
	workspace: {
		on,
		getActiveFile: () => null,
		getLeaf: () => ({ openFile: async () => {} }),
		getLeavesOfType: () => [],
		trigger: () => {},
	},
};

// --- Reserved-name guard -----------------------------------------------------

/**
 * obsidian.d.ts does not describe every member of the runtime classes: `View`
 * really has `open()` / `close()`, which the workspace calls to mount a view.
 * Shadowing one type-checks cleanly and then breaks silently, so the names are
 * listed here and checked instead.
 */
const VIEW_RESERVED = [
	"open",
	"close",
	"load",
	"unload",
	"addChild",
	"removeChild",
	"register",
	"registerEvent",
	"registerDomEvent",
	"registerInterval",
	"getState",
	"setState",
	"getEphemeralState",
	"setEphemeralState",
	"onResize",
	"onPaneMenu",
];

const PLUGIN_RESERVED = [
	"load",
	"unload",
	"addChild",
	"removeChild",
	"register",
	"registerEvent",
	"registerDomEvent",
	"registerInterval",
	"registerView",
	"addCommand",
	"addRibbonIcon",
	"addSettingTab",
	"loadData",
	"saveData",
];

function checkReservedNames(instance, BaseClass, reserved, label) {
	const shadowed = new Set();

	for (
		let proto = Object.getPrototypeOf(instance);
		proto && proto !== BaseClass.prototype;
		proto = Object.getPrototypeOf(proto)
	) {
		for (const name of Object.getOwnPropertyNames(proto)) {
			if (reserved.includes(name)) shadowed.add(name);
		}
	}
	for (const name of Object.getOwnPropertyNames(instance)) {
		if (reserved.includes(name)) shadowed.add(name);
	}

	assert.equal(
		shadowed.size,
		0,
		`${label} shadows Obsidian runtime members: ${[...shadowed].join(", ")}`,
	);
}

// --- Run ---------------------------------------------------------------------

const TreeNavPlugin = require("../main.js").default ?? require("../main.js");

const plugin = new TreeNavPlugin(app);
if (dataArg && existsSync(dataArg)) {
	plugin.data = JSON.parse(readFileSync(dataArg, "utf8"));
	console.log("replaying saved data from", dataArg);
} else if (!vaultArg) {
	// Expand the whole fixture so hiding and nesting are actually exercised.
	plugin.data = {
		version: 1,
		expandedFolders: [
			"Projects",
			"Projects/Sixtoms",
			"Projects/RE100",
			"Ideas",
			"Archive",
			"Archive/2024",
			"Archive/2024/Q1",
		],
		// Written by an older version, when this setting was a boolean.
		settings: { flattenNestedFolders: true },
		styles: { "Archive/2024": { icon: "lucide-folder", color: "var(--color-red)" } },
		// Sixtoms is alphabetically after RE100; a manual order must win.
		order: { "Projects/Sixtoms": 0, "Projects/RE100": 1 },
	};
}
await plugin.onload();

const factory = app.__viewFactories.get("treenav-view");
assert.ok(factory, "the view type was never registered");

const view = factory({ app });
await view.onOpen();

const content = view.containerEl.children[1];
const rows = [...content.querySelectorAll(".treenav-item-self")];
const titles = rows.map((r) => r.querySelector(".treenav-item-title")?.textContent);

console.log("header buttons:", content.querySelectorAll(".nav-action-button").length);
console.log("rows rendered :", rows.length);
console.log("titles        :", titles.join(", "));
if (notices.length) console.log("notices       :", notices.join(" | "));

assert.equal(
	content.querySelectorAll(".nav-action-button").length,
	3,
	"the header buttons are missing",
);
assert.ok(rows.length > 0, "the tree rendered no rows at all");
assert.ok(!titles.some((t) => t.endsWith(".md")), "no row should show a .md extension");
assert.ok(!titles.includes("attachment.txt"), "non-markdown files should be hidden");

// Every row keeps an icon slot so titles stay aligned.
assert.equal(
	rows.length,
	content.querySelectorAll(".treenav-item-icon").length,
	"some rows are missing their icon slot",
);

if (!vaultArg) {
	const count = (name) => titles.filter((t) => t === name).length;

	assert.ok(titles.includes("Planning"), "nested files are missing");
	assert.ok(titles.includes("Old note"), "deeply nested files are missing");
	// The folder note shares its folder's name, so a second "Ideas" row would
	// mean the folder note leaked into the listing.
	assert.equal(count("Ideas"), 1, "the Ideas folder note is not hidden");
	assert.equal(count("Projects"), 1, "the Projects folder note is not hidden");
	assert.equal(count("Sixtoms"), 1, "the nested Sixtoms folder note is not hidden");

	assert.ok(
		titles.indexOf("Sixtoms") < titles.indexOf("RE100"),
		"a folder's manual order should override the sort setting",
	);

	// A folder you made looks like a folder; a note looks like a note.
	const iconOf = (path) =>
		content
			.querySelector(`[data-path="${path}"] .treenav-item-icon .svg-icon`)
			?.getAttribute("data-icon");
	assert.equal(iconOf("Projects"), "folder-closed", "a plain folder should show the folder icon");
	assert.equal(iconOf("Welcome.md"), "file-text", "a note should show the note icon");

	// The boolean this setting used to be must survive the upgrade.
	assert.equal(
		plugin.state.settings.flattenNestedFolders,
		"ask",
		"the legacy boolean should migrate to a mode",
	);

	// A folder holding nothing but its own folder note has no arrow to offer.
	const emptyFolder = content.querySelector('[data-path="빈 폴더"]')?.parentElement;
	assert.ok(emptyFolder?.classList.contains("treenav-is-leaf"), "an empty folder still shows an arrow");
	const withChildren = content.querySelector('[data-path="Projects"]')?.parentElement;
	assert.ok(!withChildren?.classList.contains("treenav-is-leaf"), "a folder with children lost its arrow");

	const styled = content.querySelector('[data-path="Archive/2024"]');
	assert.ok(styled, "the styled row is missing");
	assert.equal(styled.style.color, "var(--color-red)", "a stored color was not applied");
}

checkReservedNames(view, View, VIEW_RESERVED, "TreeNavView");
checkReservedNames(plugin, Plugin, PLUGIN_RESERVED, "TreeNavPlugin");

// --- Vault operations --------------------------------------------------------

if (!vaultArg) {
	// Dropping a note on another note's icon: the target becomes a folder note
	// and adopts the dragged item.
	const dragged = byPath.get("Welcome.md");
	const target = byPath.get("Projects/Sixtoms/Planning.md");

	// The row keeps its place and its look when it becomes a folder.
	plugin.state.setOrder(["Projects/Sixtoms/Planning.md", "Projects/Sixtoms/Marketing.md"]);
	plugin.styles.update("Projects/Sixtoms/Planning.md", { icon: "lucide-star" });

	const nested = await plugin.fileOps.nestUnder(dragged, target);
	plugin.state.inherit(target.path, "Projects/Sixtoms/Planning");

	assert.ok(nested.ok, "nestUnder failed: " + nested.error);
	assert.ok(
		byPath.get("Projects/Sixtoms/Planning") instanceof TFolder,
		"nesting should create a folder named after the target note",
	);
	assert.equal(
		byPath.get("Projects/Sixtoms/Planning/Planning.md")?.path,
		"Projects/Sixtoms/Planning/Planning.md",
		"the target note should become the folder note",
	);
	assert.equal(
		byPath.get("Projects/Sixtoms/Planning/Welcome.md")?.parent?.path,
		"Projects/Sixtoms/Planning",
		"the dragged note should end up inside the new folder",
	);

	// The note still opens as before, and is now hidden from the listing.
	const folder = byPath.get("Projects/Sixtoms/Planning");
	assert.equal(
		plugin.folderNotes.getFolderNote(folder)?.path,
		"Projects/Sixtoms/Planning/Planning.md",
		"the folder note relationship should survive nesting",
	);
	assert.deepEqual(
		plugin.treeService.getVisibleChildren(folder).map((f) => f.name),
		["Welcome.md"],
		"the folder note should be hidden inside its own folder",
	);

	assert.equal(
		plugin.state.getOrder("Projects/Sixtoms/Planning"),
		0,
		"the new folder should take over the note's position",
	);
	assert.equal(
		plugin.styles.get("Projects/Sixtoms/Planning")?.icon,
		"lucide-star",
		"the new folder should take over the note's icon",
	);

	console.log("nest under note: ok");

	// Whatever the user set while it was a folder must come back with the note.
	plugin.styles.update("Projects/Sixtoms/Planning", { color: "var(--color-blue)", fontSize: 17 });
	plugin.state.setOrder(["Projects/Sixtoms/Marketing.md", "Projects/Sixtoms/Planning"]);

	// A folder that came from nesting keeps the note icon: it is still that note.
	// Checked on a folder with no icon of its own, since a custom icon always wins.
	const defaultIconFor = (file) => {
		const el = document.createElement("div");
		plugin.styles.applyToIcon(el, file);
		return el.querySelector(".svg-icon")?.getAttribute("data-icon");
	};
	const ideas = byPath.get("Ideas");
	assert.equal(defaultIconFor(ideas), "folder-closed", "a plain folder shows the folder icon");
	plugin.state.markNested("Ideas");
	assert.equal(defaultIconFor(ideas), "file-text", "a nested folder keeps the note icon");
	plugin.state.unmarkNested("Ideas");

	// Asking is the default, and declining must leave the vault alone.
	plugin.state.settings.flattenNestedFolders = "ask";
	plugin.state.markNested("Projects/Sixtoms/Planning");
	plugin.folderNotes.askFlatten = async () => "keep";
	await plugin.fileOps.move(byPath.get("Projects/Sixtoms/Planning/Welcome.md"), root);
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.ok(
		byPath.get("Projects/Sixtoms/Planning") instanceof TFolder,
		"declining the prompt must keep the folder",
	);
	console.log("prompt declined: ok");

	// Pulling the last child back out undoes the nesting entirely.
	plugin.state.settings.flattenNestedFolders = "always";
	plugin.folderNotes.askFlatten = null;
	await plugin.fileOps.move(byPath.get("Welcome.md"), byPath.get("Projects/Sixtoms/Planning"));
	plugin.state.markNested("Projects/Sixtoms/Planning");
	await plugin.fileOps.move(byPath.get("Projects/Sixtoms/Planning/Welcome.md"), root);
	plugin.folderNotes.flattenIfEmptied("Projects/Sixtoms/Planning");
	await new Promise((resolve) => setTimeout(resolve, 5));

	assert.equal(
		byPath.get("Projects/Sixtoms/Planning"),
		undefined,
		"the emptied folder should be gone",
	);
	assert.equal(
		byPath.get("Projects/Sixtoms/Planning.md")?.path,
		"Projects/Sixtoms/Planning.md",
		"the folder note should be back where it started",
	);
	assert.equal(plugin.state.isNested("Projects/Sixtoms/Planning"), false, "tracking should be dropped");
	assert.deepEqual(
		plugin.styles.get("Projects/Sixtoms/Planning.md"),
		{ icon: "lucide-star", color: "var(--color-blue)", fontSize: 17 },
		"the restored note should keep the style set while it was a folder",
	);
	assert.equal(
		plugin.state.getOrder("Projects/Sixtoms/Planning.md"),
		1,
		"the restored note should keep the folder's position",
	);

	console.log("flatten back to note: ok");

	// "Ideas" holds nothing but its own folder note, yet the user made it — it
	// must survive untouched.
	assert.equal(byPath.get("Ideas").children.length, 1, "fixture assumption broke");
	plugin.folderNotes.flattenIfEmptied("Ideas");
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.ok(byPath.get("Ideas") instanceof TFolder, "a user-made folder must survive");
	assert.ok(byPath.get("Ideas/Ideas.md"), "its folder note must stay put");

	console.log("user folder untouched: ok");

	// --- Outline moves -------------------------------------------------------

	const namesIn = (path) =>
		plugin.treeService.getVisibleChildren(byPath.get(path)).map((f) => f.name);

	const sixtoms = "Projects/Sixtoms";
	assert.deepEqual(namesIn(sixtoms), ["Marketing.md", "Planning.md"], "fixture assumption broke");

	plugin.outline.moveStep(byPath.get("Projects/Sixtoms/Planning.md"), -1);
	assert.deepEqual(namesIn(sixtoms), ["Planning.md", "Marketing.md"], "move up did not take");

	plugin.outline.moveToEdge(byPath.get("Projects/Sixtoms/Planning.md"), "bottom");
	assert.deepEqual(namesIn(sixtoms), ["Marketing.md", "Planning.md"], "move to bottom did not take");

	// Indenting under the note above nests it, exactly as the drag would.
	await plugin.outline.indent(byPath.get("Projects/Sixtoms/Planning.md"));
	assert.equal(
		byPath.get("Projects/Sixtoms/Marketing/Planning.md")?.parent?.path,
		"Projects/Sixtoms/Marketing",
		"indent should nest under the item above",
	);
	assert.ok(
		plugin.state.isNested("Projects/Sixtoms/Marketing"),
		"a folder made by indenting should be undoable like a nest",
	);

	// Outdenting puts it back beside its former parent.
	await plugin.outline.outdent(byPath.get("Projects/Sixtoms/Marketing/Planning.md"));
	assert.equal(
		byPath.get("Projects/Sixtoms/Planning.md")?.parent?.path,
		sixtoms,
		"outdent should lift the item to its grandparent",
	);
	assert.deepEqual(
		namesIn(sixtoms),
		["Marketing", "Planning.md"],
		"outdent should land directly after the former parent",
	);

	// The first item has nothing above it, and the top level has nowhere to go.
	const before = namesIn(sixtoms);
	await plugin.outline.indent(byPath.get("Projects/Sixtoms/Marketing"));
	await plugin.outline.outdent(byPath.get("Welcome.md"));
	assert.deepEqual(namesIn(sixtoms), before, "the first item must not indent");
	assert.equal(byPath.get("Welcome.md")?.parent?.path, "/", "a root item must not outdent");

	console.log("outline moves: ok");

	// --- Appearance ----------------------------------------------------------

	const probe = document.createElement("div");
	const folderEmoji = "\u{1F4C1}️";

	// Emoji go in as text and keep their own colours; icon ids go through setIcon.
	plugin.styles.update("Welcome.md", { icon: folderEmoji });
	plugin.styles.applyToIcon(probe, byPath.get("Welcome.md"));
	assert.equal(probe.textContent, folderEmoji, "an emoji icon should render as text");
	assert.ok(probe.classList.contains("treenav-is-emoji"), "an emoji icon should be marked");

	plugin.styles.update("Welcome.md", { icon: "lucide-star" });
	plugin.styles.applyToIcon(probe, byPath.get("Welcome.md"));
	assert.equal(
		probe.querySelector(".svg-icon")?.getAttribute("data-icon"),
		"lucide-star",
		"an icon id should still go through setIcon",
	);
	assert.ok(!probe.classList.contains("treenav-is-emoji"), "the emoji mark should be cleared");

	// A typeface resolves to the running theme's variable, not a font name.
	plugin.styles.update("Welcome.md", { fontFamily: "monospace" });
	plugin.styles.applyToRow(probe, "Welcome.md");
	assert.equal(
		probe.style.fontFamily,
		"var(--font-monospace)",
		"a typeface should resolve to a theme variable",
	);

	// A typed name is passed through as written, fallbacks and all.
	plugin.styles.update("Welcome.md", { fontFamily: "Pretendard, Malgun Gothic, sans-serif" });
	plugin.styles.applyToRow(probe, "Welcome.md");
	assert.equal(
		probe.style.fontFamily.replace(/"/g, ""),
		"Pretendard, Malgun Gothic, sans-serif",
		"a literal font stack should reach the row untouched",
	);

	plugin.styles.clear("Welcome.md");

	// The classic style is a class on the container, so it costs no re-render.
	const treeEl = content.querySelector(".treenav-tree");
	assert.ok(!treeEl.classList.contains("treenav-style-classic"), "modern is the default");
	plugin.state.settings.treeStyle = "classic";
	view.applyTreeStyle();
	assert.ok(treeEl.classList.contains("treenav-style-classic"), "classic style did not apply");
	assert.ok(!treeEl.classList.contains("treenav-lines-solid"), "dotted is the classic default");
	plugin.state.settings.treeStyle = "classic-solid";
	view.applyTreeStyle();
	assert.ok(treeEl.classList.contains("treenav-style-classic"), "solid is still a classic style");
	assert.ok(treeEl.classList.contains("treenav-lines-solid"), "solid lines did not apply");

	plugin.state.settings.treeStyle = "modern";
	view.applyTreeStyle();
	assert.ok(!treeEl.classList.contains("treenav-style-classic"), "modern should clear both");
	assert.ok(!treeEl.classList.contains("treenav-lines-solid"), "modern should clear both");

	console.log("appearance: ok");
}

console.log("\nsmoke test passed");
