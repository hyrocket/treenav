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
globalThis.Element = window.Element;
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
		// Written just now, which is what the age filter reads.
		this.stat = { ctime: Date.now(), mtime: Date.now(), size: 0 };
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
/** Every dialog the run opens, so a test can reach into the last one. */
const openedModals = [];

class Modal {
	constructor(app) {
		this.app = app;
		this.modalEl = document.createElement("div");
		this.contentEl = this.modalEl.appendChild(document.createElement("div"));
		this.titleEl = document.createElement("div");
	}
	open() {
		openedModals.push(this);
		this.onOpen?.();
	}
	close() {
		this.onClose?.();
	}
}
class SuggestModal extends Modal {
	constructor(app) {
		super(app);
		this.limit = 50;
		this.inputEl = document.createElement("input");
		this.resultContainerEl = this.modalEl.appendChild(document.createElement("div"));
		this.rendered = [];
		this.inputEl.addEventListener("input", () => this.runQuery());
	}
	setPlaceholder() {}
	setInstructions() {}
	onOpen() {}
	/** What the suggester does for itself: ask, then draw. */
	runQuery() {
		this.rendered = this.getSuggestions(this.inputEl.value) ?? [];
		this.resultContainerEl.empty();
		for (const item of this.rendered) {
			this.renderSuggestion(item, this.resultContainerEl.createDiv({ cls: "suggestion-item" }));
		}
	}
	/** Typing, as the test does it. */
	type(query) {
		this.inputEl.value = query;
		this.runQuery();
	}
}

class FuzzySuggestModal extends SuggestModal {
	getSuggestions(query) {
		const needle = query.toLowerCase();
		return this.getItems()
			.filter((item) => this.getItemText(item).toLowerCase().includes(needle))
			.map((item) => ({ item, match: { score: 0, matches: [] } }));
	}
	renderSuggestion() {}
}
/** Menus the run opened, so a gesture that should raise one can be checked. */
const openedMenus = [];

class Menu {
	constructor() {
		this.items = [];
	}
	addItem(cb) {
		const entry = {
			setTitle(title) {
				this.title = title;
				return this;
			},
			setIcon() {
				return this;
			},
			onClick(fn) {
				this.click = fn;
				return this;
			},
		};
		cb(entry);
		this.items.push(entry);
		return this;
	}
	addSeparator() {
		return this;
	}
	showAtMouseEvent() {
		openedMenus.push(this);
	}
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
	addSettingTab(tab) {
		this.settingTab = tab;
	}
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

/**
 * The settings components, backed by real elements. A dialog that only pretends
 * to build its controls proves nothing about the dialog.
 */
class ValueComponent {
	constructor(el) {
		this.el = el;
		this.changeCb = null;
	}
	setValue(value) {
		this.value = value;
		return this;
	}
	getValue() {
		return this.value;
	}
	onChange(cb) {
		this.changeCb = cb;
		return this;
	}
	/** What the user doing something to the control amounts to. */
	change(value) {
		this.setValue(value);
		this.changeCb?.(value);
	}
	setDisabled() {
		return this;
	}
	setPlaceholder() {
		return this;
	}
	setLimits() {
		return this;
	}
	setDynamicTooltip() {
		return this;
	}
	addOptions(options) {
		this.options = options;
		return this;
	}
}

class ButtonComponent {
	constructor(containerEl) {
		this.buttonEl = containerEl.createEl("button");
	}
	setButtonText(text) {
		this.buttonEl.setText(text);
		return this;
	}
	setIcon(icon) {
		this.buttonEl.setAttribute("data-icon", icon);
		return this;
	}
	setTooltip(text) {
		this.buttonEl.setAttribute("aria-label", text);
		return this;
	}
	setCta() {
		this.buttonEl.addClass("mod-cta");
		return this;
	}
	setWarning() {
		this.buttonEl.addClass("mod-warning");
		return this;
	}
	setClass(cls) {
		this.buttonEl.addClass(cls);
		return this;
	}
	setDisabled() {
		return this;
	}
	onClick(cb) {
		this.buttonEl.addEventListener("click", cb);
		return this;
	}
}

class Setting {
	constructor(containerEl) {
		this.settingEl = containerEl.createDiv({ cls: "setting-item" });
		this.nameEl = this.settingEl.createDiv({ cls: "setting-item-name" });
		this.descEl = this.settingEl.createDiv({ cls: "setting-item-description" });
		this.controlEl = this.settingEl.createDiv({ cls: "setting-item-control" });
		this.components = [];
	}
	setName(text) {
		this.nameEl.setText(text);
		return this;
	}
	setDesc(text) {
		this.descEl.setText(text);
		return this;
	}
	setHeading() {
		return this;
	}
	addButton(cb) {
		const button = new ButtonComponent(this.controlEl);
		this.components.push(button);
		cb(button);
		return this;
	}
	addExtraButton(cb) {
		return this.addButton(cb);
	}
	addToggle(cb) {
		return this.addValue(cb);
	}
	addDropdown(cb) {
		return this.addValue(cb);
	}
	addSlider(cb) {
		return this.addValue(cb);
	}
	addColorPicker(cb) {
		return this.addValue(cb);
	}
	addText(cb) {
		return this.addValue(cb);
	}
	addValue(cb) {
		const component = new ValueComponent(this.controlEl.createDiv());
		this.components.push(component);
		cb(component);
		return this;
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
	SuggestModal,
	Menu,
	Plugin,
	PluginSettingTab,
	Notice: class {
		constructor(message) {
			notices.push(String(message));
		}
	},
	Setting,
	ButtonComponent,
	Platform: { isMacOS: false },
	Keymap: { isModEvent: (event) => !!(event?.ctrlKey || event?.metaKey) },
	setIcon: (el, icon) => {
		const svg = document.createElement("span");
		svg.className = "svg-icon";
		svg.setAttribute("data-icon", icon);
		el.appendChild(svg);
	},
	getIconIds: () => ["lucide-folder", "lucide-file"],
	getAllTags: (cache) => (cache?.tags ?? []).map((entry) => entry.tag),
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

const benchArg = argValue("--bench");

const spec = benchArg
	? syntheticSpec(Number(benchArg))
	: vaultArg
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

/**
 * A vault of `count` notes in a shape a real one tends to have: a few dozen
 * top-level folders, three levels deep, a dozen notes in each leaf, and a
 * folder note here and there.
 */
function syntheticSpec(count) {
	const paths = [];
	const TOP = 24;
	const MID = 4;
	const SUB = 3;
	// Spread over the whole shape rather than filling the first branch deep.
	const perLeaf = Math.max(1, Math.ceil(count / (TOP * MID * SUB)));

	outer: for (let a = 0; a < TOP; a += 1) {
		const top = `Area ${pad(a)}`;
		paths.push(`${top}/${top}.md`);
		for (let b = 0; b < MID; b += 1) {
			const mid = `${top}/Project ${pad(b)}`;
			for (let c = 0; c < SUB; c += 1) {
				const leaf = `${mid}/Part ${pad(c)}`;
				for (let n = 0; n < perLeaf; n += 1) {
					paths.push(`${leaf}/Note ${pad(n)} in ${top}.md`);
					if (paths.length >= count) break outer;
				}
			}
		}
	}
	return paths;
}

function pad(n) {
	return String(n).padStart(2, "0");
}

function argValue(flag) {
	const index = process.argv.indexOf(flag);
	return index === -1 ? undefined : process.argv[index + 1];
}

/**
 * What the tree costs at a given size.
 *
 * jsdom is far slower at building DOM than the browser Obsidian runs on, so
 * these numbers are an upper bound rather than a prediction. What they are for
 * is the shape: run two sizes and see whether the cost follows the file count
 * or the square of it.
 */
function runBench() {
	const files = [...byPath.values()].filter((f) => !(f instanceof TFolder)).length;
	const folders = [...byPath.values()].filter((f) => f instanceof TFolder).length - 1;

	const time = (label, fn) => {
		const started = performance.now();
		const detail = fn();
		const ms = performance.now() - started;
		results.push({ what: label, ms: Number(ms.toFixed(1)), detail: detail ?? "" });
	};

	const results = [];
	const renderer = view.renderer;

	time("render collapsed", () => {
		view.rebuild();
		return `${countRows()} rows`;
	});

	time("expand every folder", () => {
		renderer.expandAll();
		return `${countRows()} rows`;
	});

	time("walk for the fold button", () => {
		for (let i = 0; i < 20; i += 1) renderer.hasExpanded();
		return "x20";
	});

	time("list the visible rows", () => {
		for (let i = 0; i < 20; i += 1) renderer.getVisibleItems();
		return "x20";
	});

	time("sort one folder", () => {
		const folder = byPath.get("Area 00/Project 00/Part 00");
		for (let i = 0; i < 200; i += 1) plugin.treeService.getVisibleChildren(folder);
		return "x200";
	});

	time("refresh one folder", () => {
		view.refreshFolder("Area 00/Project 00/Part 00");
		renderer.flush();
		return "";
	});

	time("match every name", () => {
		let hits = 0;
		for (let i = 0; i < 10; i += 1) {
			hits = 0;
			for (const file of byPath.values()) {
				if (file.name.toLowerCase().includes("note 07")) hits += 1;
			}
		}
		return `${hits} hits x10`;
	});

	time("collapse everything", () => {
		renderer.collapseAll();
		return `${countRows()} rows`;
	});

	console.log(`\nvault: ${files} files, ${folders} folders\n`);
	for (const row of results) {
		console.log(`  ${row.what.padEnd(26)} ${String(row.ms).padStart(8)} ms   ${row.detail}`);
	}
	console.log("");
}

function countRows() {
	return content.querySelectorAll(".treenav-item-self").length;
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

/** Leaves the run has opened, in the shape `getLeavesOfType` reports. */
const openLeaves = [];

/** What the workspace reports as the note being edited. */
let activeFile = null;

/** Tags the fake metadata cache reports. Keyed by name: files get moved here. */
const TAGS = {
	Welcome: ["#project/alpha", "#todo"],
	Planning: ["#project"],
};

/** Callbacks the plugin asked to run once the layout is up. */
const layoutReady = [];

const app = {
	__viewFactories: new Map(),
	vault: {
		getRoot: () => root,
		getAbstractFileByPath: (p) => byPath.get(p) ?? null,
		getFiles: () => [...byPath.values()].filter((f) => f instanceof TFile),
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
		copy: async (file, newPath) => {
			const slash = newPath.lastIndexOf("/");
			const parent = slash === -1 ? root : folderAt(newPath.slice(0, slash));
			const copy = new TFile(newPath, parent);
			parent.children.push(copy);
			byPath.set(newPath, copy);
			emit("create", copy);
			return copy;
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
	metadataCache: {
		// Only what the search reads: a couple of files carry tags.
		getFileCache: (file) => ({ tags: (TAGS[file.basename] ?? []).map((tag) => ({ tag })) }),
	},
	workspace: {
		on,
		// Settable, so revealing the note being edited can be exercised.
		getActiveFile: () => activeFile,
		// Recorded rather than run: what matters is whether it was asked for.
		onLayoutReady: (cb) => layoutReady.push(cb),
		getLeftLeaf: () => null,
		revealLeaf: async () => {},
		getLeaf: () => ({ openFile: async () => {} }),
		// The plugin fans work out to its open views through here, so the one the
		// run creates has to be reachable.
		getLeavesOfType: (type) => openLeaves.filter((leaf) => leaf.view?.getViewType?.() === type),
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
		styles: {
			"Archive/2024": {
				icon: "lucide-folder",
				color: "var(--color-red)",
				// Written by a version that let a typeface be any font name.
				fontFamily: "Comic Sans MS",
			},
		},
		// Sixtoms is alphabetically after RE100; a manual order must win.
		order: { "Projects/Sixtoms": 0, "Projects/RE100": 1 },
	};
}
await plugin.onload();

// A vault that has used TreeNav before keeps whatever layout the user chose;
// only a first run opens the view by itself.
assert.equal(
	layoutReady.length,
	0,
	"a vault with saved state should not have its view opened for it",
);

// The settings tab builds itself only when opened, so nothing else would run it.
assert.ok(plugin.settingTab, "no settings tab was registered");
plugin.settingTab.display();
assert.ok(
	plugin.settingTab.containerEl.querySelectorAll(".setting-item").length > 5,
	"the settings tab did not build its rows",
);

const factory = app.__viewFactories.get("treenav-view");
assert.ok(factory, "the view type was never registered");

const leaf = { app };
const view = factory(leaf);
leaf.view = view;
openLeaves.push(leaf);
await view.onOpen();

const content = view.containerEl.children[1];

if (benchArg) {
	runBench();
	process.exit(0);
}

const rows = [...content.querySelectorAll(".treenav-item-self")];
const titles = rows.map((r) => r.querySelector(".treenav-item-title")?.textContent);

console.log("header buttons:", content.querySelectorAll(".nav-action-button").length);
console.log("rows rendered :", rows.length);
console.log("titles        :", titles.join(", "));
if (notices.length) console.log("notices       :", notices.join(" | "));

assert.equal(
	content.querySelectorAll(".nav-action-button").length,
	4,
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
	// A typeface that is not a token can no longer be edited, so loading drops it.
	assert.equal(
		plugin.state.getStyle("Archive/2024").fontFamily,
		undefined,
		"a legacy font name should be dropped on load",
	);
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

	// Only the tokens resolve. A font name from an older version is not one, and
	// no dialog can edit it any more, so it must not reach the row.
	plugin.styles.update("Welcome.md", { fontFamily: "Pretendard, Malgun Gothic, sans-serif" });
	plugin.styles.applyToRow(probe, "Welcome.md");
	assert.equal(probe.style.fontFamily, "", "a typed font stack should no longer apply");

	plugin.styles.clear("Welcome.md");

	// --- The appearance dialog ---------------------------------------------
	//
	// Driven through the real dialog rather than the service behind it: the
	// point of merging colour and font into one place is that the controls and
	// the preview agree, and only opening it can show that.

	const item = view.renderer.itemsByPath.get("Welcome.md");
	assert.ok(item, "the row to style is missing");

	view.promptAppearance(item);
	const modal = openedModals.at(-1);
	const previewRow = modal.contentEl.querySelector(".treenav-appearance-preview .treenav-item-self");
	assert.ok(previewRow, "the dialog should preview the row");
	assert.equal(
		previewRow.querySelector(".treenav-item-title").textContent,
		"Welcome",
		"the preview should carry the item's name",
	);

	const button = (icon) => modal.contentEl.querySelector(`button[data-icon="${icon}"]`);
	button("bold").click();
	assert.equal(previewRow.style.fontWeight, "bold", "the preview should follow the draft");
	assert.equal(
		plugin.styles.get("Welcome.md"),
		undefined,
		"nothing should be stored before Apply",
	);

	modal.contentEl.querySelector('.treenav-swatch[aria-label="Blue"]').click();
	assert.equal(previewRow.style.color, "var(--color-blue)", "a swatch should reach the preview");

	// The second grid is the highlighter; its colours share names with the first.
	const highlights = modal.contentEl.querySelectorAll(".treenav-swatch-grid")[1];
	assert.ok(highlights, "the highlight swatches are missing");
	highlights.children[0].click();
	const previewTitle = previewRow.querySelector(".treenav-item-title");
	assert.ok(
		previewTitle.classList.contains("treenav-has-highlight"),
		"a highlight should shrink the name to its text",
	);

	const named = (text) =>
		[...modal.contentEl.querySelectorAll("button")].find((el) => el.textContent === text);
	named("Apply").click();

	const stored = plugin.styles.get("Welcome.md");
	assert.equal(stored?.fontWeight, "bold", "Apply should store the emphasis");
	assert.equal(stored?.color, "var(--color-blue)", "Apply should store the color");
	const row = content.querySelector('[data-path="Welcome.md"]');
	assert.equal(row.style.fontWeight, "bold", "the tree row should follow the dialog");
	assert.ok(
		row.querySelector(".treenav-item-title").classList.contains("treenav-has-highlight"),
		"the highlight should reach the tree row too",
	);

	// Reset clears every property at once, including the icon.
	plugin.styles.update("Welcome.md", { icon: "lucide-star" });
	view.promptAppearance(view.renderer.itemsByPath.get("Welcome.md"));
	const reopened = openedModals.at(-1);
	[...reopened.contentEl.querySelectorAll("button")]
		.find((el) => el.textContent === "Reset all")
		.click();
	assert.equal(plugin.styles.get("Welcome.md"), undefined, "Reset all should clear the style");
	assert.equal(row.style.color, "", "the tree row should go back to the theme color");
	console.log("appearance dialog: ok");

	// The classic style is a class on the container, so it costs no re-render.
	const treeEl = content.querySelector(".treenav-tree");
	assert.ok(!treeEl.classList.contains("treenav-style-classic"), "modern is the default");
	plugin.state.settings.treeStyle = "classic";
	view.applyTreeStyle();
	assert.ok(treeEl.classList.contains("treenav-style-classic"), "classic style did not apply");
	plugin.state.settings.treeStyle = "modern";
	view.applyTreeStyle();
	assert.ok(!treeEl.classList.contains("treenav-style-classic"), "modern did not restore");

	console.log("appearance: ok");
}

// --- Multi-selection and multi-drag --------------------------------------
//
// Driven through the row's own listeners: the click gestures and the drag
// handlers are the whole feature, so testing the services underneath them
// would prove nothing about it.

view.rebuild();
const rowFor = (path) => view.renderer.getItem(path)?.rowEl;
const itemFor = (path) => view.renderer.getItem(path);

const click = (path, opts = {}) =>
	rowFor(path).dispatchEvent(new window.MouseEvent("click", { bubbles: true, ...opts }));

const MEETING = "Projects/RE100/Meeting.md";

click("Welcome.md");
click(MEETING, { ctrlKey: true });
assert.deepEqual(
	view.renderer.getSelection().map((item) => item.path),
	[MEETING, "Welcome.md"],
	"a modifier click should add to the selection",
);
assert.ok(
	rowFor("Welcome.md").classList.contains("treenav-is-selected") &&
		rowFor(MEETING).classList.contains("treenav-is-selected"),
	"both selected rows should be marked",
);

// Clicking the same row again takes it back out.
click(MEETING, { ctrlKey: true });
assert.deepEqual(
	view.renderer.getSelection().map((item) => item.path),
	["Welcome.md"],
	"a second modifier click should remove the row",
);

// A range runs from the anchor to the shift-clicked row, in screen order.
const visiblePaths = view.renderer.getVisibleItems().map((item) => item.path);
click(visiblePaths[0]);
click(visiblePaths[2], { shiftKey: true });
assert.deepEqual(
	view.renderer.getSelection().map((item) => item.path),
	visiblePaths.slice(0, 3),
	"shift-click should select the range between",
);

// Escape narrows back to one row rather than clearing everything.
assert.ok(view.renderer.collapseSelection(), "Escape should have something to narrow");
assert.equal(view.renderer.getSelection().length, 1, "narrowing should leave one row");

// --- Dragging what is selected -------------------------------------------

/**
 * jsdom lays nothing out, so the rows have to be told where they are: the drag
 * layer reads their boxes and asks what sits under the pointer.
 */
const placed = [];
document.elementFromPoint = (x, y) => {
	const hit = placed.find((row) => y >= row.top && y < row.top + 20);
	return hit ? hit.el : null;
};

const placeRow = (path, box) => {
	const row = rowFor(path);
	row.getBoundingClientRect = () => ({
		top: box.top,
		bottom: box.top + 20,
		height: 20,
		left: 0,
		right: 200,
		width: 200,
	});
	row.querySelector(".treenav-item-icon").getBoundingClientRect = () => ({
		top: box.top,
		bottom: box.top + 16,
		height: 16,
		left: 30,
		right: 46,
		width: 16,
	});
	placed.unshift({ el: row, top: box.top });
	return row;
};

/** A pointer event jsdom will carry; it has no PointerEvent of its own. */
const pointer = (type, x, y, extra = {}) =>
	Object.assign(new window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }), {
		pointerId: 1,
		pointerType: "mouse",
		...extra,
	});

/** Press on one row, move to a point, release: the whole gesture. */
const drag = (fromPath, point, extra = {}) => {
	const from = rowFor(fromPath);
	const box = placed.find((row) => row.el === from);
	const startY = box ? box.top + 10 : 0;

	from.dispatchEvent(pointer("pointerdown", 100, startY, extra));
	// The first move is what turns a press into a drag.
	window.dispatchEvent(pointer("pointermove", 100 + 10, startY, extra));
	window.dispatchEvent(pointer("pointermove", point.x, point.y, extra));
	window.dispatchEvent(pointer("pointerup", point.x, point.y, extra));
};

// Two notes in different folders, dragged into a third by grabbing one.
click("Welcome.md");
click(MEETING, { ctrlKey: true });
placeRow("Welcome.md", { top: 0 });
placeRow(MEETING, { top: 20 });
placeRow("Archive", { top: 40 });

assert.ok(
	rowFor("Welcome.md").classList.contains("treenav-is-selected"),
	"the drag should start from a selected row",
);
drag("Welcome.md", { x: 150, y: 50 });
await new Promise((resolve) => setTimeout(resolve, 5));

assert.equal(
	byPath.get("Archive/Welcome.md")?.parent?.path,
	"Archive",
	"the dragged row should have moved",
);
assert.equal(
	byPath.get("Archive/Meeting.md")?.parent?.path,
	"Archive",
	"the rest of the selection should have moved with it",
);

// Dragging a row that is not selected carries that row and nothing else.
view.rebuild();
placed.length = 0;
view.renderer.getItem("Archive").setExpanded(true);
placeRow("Archive/Welcome.md", { top: 0 });
placeRow("Archive/Meeting.md", { top: 20 });
placeRow("Projects", { top: 40 });

click("Archive/Welcome.md");
click("Archive/Meeting.md", { ctrlKey: true });
drag("Projects", { x: 150, y: 5 });
await new Promise((resolve) => setTimeout(resolve, 5));

assert.equal(
	byPath.get("Archive/Projects")?.parent?.path,
	"Archive",
	"the unselected row should have moved on its own",
);
assert.equal(
	byPath.get("Archive/Welcome.md")?.parent?.path,
	"Archive",
	"an unselected drag must leave the selection where it is",
);

console.log("multi-select drag: ok");

// --- Touch gestures ----------------------------------------------------------
//
// A finger produces no HTML5 drag events at all, which is why the drag layer is
// built on pointer events. The gesture differs from the mouse: press and hold,
// then move to drag or let go for the menu.

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TOUCH = { pointerType: "touch", pointerId: 2 };

view.rebuild();
placed.length = 0;
view.renderer.getItem("Archive").setExpanded(true);
placeRow("Archive/Welcome.md", { top: 0 });
placeRow("Archive/Projects", { top: 20 });
placeRow("Ideas", { top: 60 });

// Moving straight away is a scroll, not a drag: nothing may be picked up.
const before = byPath.get("Archive/Welcome.md").parent.path;
rowFor("Archive/Welcome.md").dispatchEvent(pointer("pointerdown", 100, 10, TOUCH));
window.dispatchEvent(pointer("pointermove", 100, 60, TOUCH));
await wait(450);
window.dispatchEvent(pointer("pointerup", 100, 60, TOUCH));
await wait(5);
assert.equal(
	byPath.get("Archive/Welcome.md").parent.path,
	before,
	"a finger that moves straight away is scrolling, not dragging",
);

// Press, hold, then move: that is a drag.
openedMenus.length = 0;
rowFor("Archive/Welcome.md").dispatchEvent(pointer("pointerdown", 100, 10, TOUCH));
await wait(450);
assert.ok(
	rowFor("Archive/Welcome.md").classList.contains("treenav-is-held"),
	"the long press should show that the row is held",
);
assert.ok(
	document.body.querySelector(".treenav-drag-ghost"),
	"a held row should show what is being dragged",
);
window.dispatchEvent(pointer("pointermove", 100, 65, TOUCH));
window.dispatchEvent(pointer("pointerup", 100, 65, TOUCH));
await wait(5);

assert.equal(
	byPath.get("Ideas/Welcome.md")?.parent?.path,
	"Ideas",
	"a long press and a move should drop the row",
);
assert.ok(!document.body.querySelector(".treenav-drag-ghost"), "the preview should be cleaned up");
assert.equal(openedMenus.length, 0, "a drag must not also open the menu");

// Press, hold, let go without moving: that is the menu.
view.rebuild();
placed.length = 0;
view.renderer.getItem("Ideas").setExpanded(true);
placeRow("Ideas/Welcome.md", { top: 0 });

rowFor("Ideas/Welcome.md").dispatchEvent(pointer("pointerdown", 100, 10, TOUCH));
await wait(450);
window.dispatchEvent(pointer("pointerup", 100, 10, TOUCH));
await wait(5);

assert.equal(openedMenus.length, 1, "holding and letting go should open the menu");
assert.ok(
	openedMenus[0].items.some((entry) => entry.title === "Rename"),
	"the menu should be the row's own",
);
assert.equal(
	byPath.get("Ideas/Welcome.md")?.parent?.path,
	"Ideas",
	"opening the menu must not move anything",
);

console.log("touch gestures: ok");

// --- Escape gives a drag back ------------------------------------------------
//
// The browser did this for us while the drag was an HTML5 one; on pointer
// events it has to be handled, or a drag begun by mistake has no way out.

view.rebuild();
placed.length = 0;
view.renderer.getItem("Ideas").setExpanded(true);
placeRow("Ideas/Welcome.md", { top: 0 });
placeRow("Archive", { top: 40 });

rowFor("Ideas/Welcome.md").dispatchEvent(pointer("pointerdown", 100, 10));
window.dispatchEvent(pointer("pointermove", 110, 10));
assert.ok(document.body.querySelector(".treenav-drag-ghost"), "the drag should have started");

window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
assert.ok(!document.body.querySelector(".treenav-drag-ghost"), "Escape should call the drag off");

window.dispatchEvent(pointer("pointerup", 150, 50));
await wait(5);
assert.equal(
	byPath.get("Ideas/Welcome.md")?.parent?.path,
	"Ideas",
	"a cancelled drag must leave the vault alone",
);
assert.equal(byPath.get("Archive/Welcome.md"), undefined, "a cancelled drag must not drop");

console.log("drag cancel: ok");

// --- One button for collapse and expand --------------------------------------

const foldEl = content.querySelector('.nav-action-button[aria-label="Collapse all"]');
assert.ok(foldEl, "the fold button is missing");

view.renderer.getItem("Archive").setExpanded(true);
assert.ok(view.renderer.hasExpanded(), "something should be open to collapse");

view.toggleFold();
assert.ok(!view.renderer.hasExpanded(), "the button should have collapsed everything");
assert.equal(foldEl.getAttribute("aria-label"), "Expand all", "it should now offer the opposite");
assert.equal(
	foldEl.querySelector(".svg-icon")?.getAttribute("data-icon"),
	"chevrons-up-down",
	"and say so with its icon",
);

view.toggleFold();
assert.ok(
	view.renderer.getItem("Archive/2024/Q1/Old note.md"),
	"expanding should reach all the way down",
);
assert.equal(foldEl.getAttribute("aria-label"), "Collapse all", "it should offer the opposite again");

console.log("fold toggle: ok");

// --- What the context menu offers, and in what order --------------------------

openedMenus.length = 0;
rowFor("Ideas/Welcome.md").dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true }));
assert.equal(openedMenus.length, 1, "right-click should open a menu");

const menuTitles = openedMenus[0].items.map((entry) => entry.title);
assert.deepEqual(
	menuTitles.slice(0, 5),
	["Open", "Open in new tab", "Rename", "Set icon", "Font & color"],
	"the menu should lead with what is reached for most",
);
assert.equal(menuTitles.at(-1), "Delete", "the one that is hard to take back goes last");
assert.ok(menuTitles.includes("Outdent"), "the outline moves should still be offered");
// The core file explorer contributes its own mover, so ours would be a second one.
assert.ok(
	!menuTitles.includes("Move to…"),
	"the single-item menu should not duplicate the core mover",
);

console.log("context menu: ok");

// --- Double-clicking a folder folds it ---------------------------------------

const ideas = view.renderer.getItem("Ideas");
ideas.setExpanded(true);
assert.ok(ideas.isExpanded, "the folder should start open");
ideas.rowEl.dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true }));
assert.ok(!ideas.isExpanded, "a double click should fold the folder");

// A note has nothing to fold, and must not be disturbed by one.
const note = view.renderer.getItem("Ideas/Welcome.md") ?? view.renderer.getVisibleItems()[0];
note.rowEl.dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true }));

console.log("double click: ok");

// --- Making a copy -----------------------------------------------------------
//
// The core explorer offers this but fills its own menu before firing the event
// other menus listen to, so it has to be rebuilt rather than inherited.

const original = byPath.get("Ideas/Welcome.md") ?? byPath.get("Welcome.md");
assert.ok(original, "the note to copy is missing");
const copied = await plugin.fileOps.duplicate(original);
assert.ok(copied.ok, "the copy should have been made");
assert.equal(copied.value.parent.path, original.parent.path, "a copy belongs beside its original");
assert.notEqual(copied.value.path, original.path, "a copy needs a name of its own");
assert.ok(copied.value.name.endsWith(".md"), "the extension should be kept");

console.log("make a copy: ok");

// --- Revealing the note being edited -----------------------------------------

view.renderer.collapseAll();
const deep = byPath.get("Archive/2024/Q1/Old note.md");
assert.ok(deep, "the note to reveal is missing");
assert.equal(view.renderer.getItem(deep.path), undefined, "it should start out of sight");

activeFile = deep;
view.revealActive();

assert.ok(view.renderer.getItem(deep.path), "revealing should open the folders in the way");
assert.equal(
	view.renderer.getSelected()?.path,
	deep.path,
	"the revealed row should be the one selected",
);

// A hidden folder note has no row of its own; its folder carries it.
view.renderer.collapseAll();
activeFile = byPath.get("Ideas/Ideas.md");
assert.ok(activeFile, "the folder note is missing");
view.revealActive();
assert.equal(
	view.renderer.getSelected()?.path,
	"Ideas",
	"a hidden folder note should reveal its folder",
);

activeFile = null;
console.log("reveal active: ok");

// --- Finding a file ----------------------------------------------------------
//
// Everything the filters read is Obsidian's own: kind, extension, modification
// time and tags. TreeNav's icons and colours are deliberately not among them.

const found = (query, filters = {}) =>
	plugin.search
		.search(query, { kind: "any", extension: null, age: "any", tag: null, ...filters }, 100)
		.files.map((f) => f.name);

assert.ok(found("welcome").includes("Welcome.md"), "a name should be found by part of it");
assert.ok(found("WELCOME").includes("Welcome.md"), "case should not matter");
assert.equal(found("no such file anywhere").length, 0, "a miss should find nothing");

// A name that starts with the query comes before one that merely contains it.
const ranked = plugin.search
	.search("m", { kind: "any", extension: null, age: "any", tag: null }, 100)
	.files.map((f) => f.basename);
const startsWith = ranked.findIndex((name) => name.toLowerCase().startsWith("m"));
const contains = ranked.findIndex(
	(name) => !name.toLowerCase().startsWith("m") && name.toLowerCase().includes("m"),
);
assert.ok(
	startsWith === -1 || contains === -1 || startsWith < contains,
	"a name that starts with the query should rank first",
);

assert.ok(found("", { kind: "attachments" }).includes("attachment.txt"), "attachments filter");
assert.ok(!found("", { kind: "notes" }).includes("attachment.txt"), "notes filter excludes it");
assert.deepEqual(found("", { extension: "txt" }), ["attachment.txt"], "extension filter");

// A parent tag stands for everything under it.
assert.ok(found("", { tag: "todo" }).includes("Welcome.md"), "tag filter");
assert.ok(found("", { tag: "project" }).includes("Welcome.md"), "#project should match #project/alpha");
assert.ok(!found("", { tag: "todo" }).includes("attachment.txt"), "an untagged file is excluded");

// Nothing in the fixture is older than this run, so the age filter keeps it all.
assert.ok(found("", { age: "week" }).length > 0, "recently written files are recent");

assert.ok(plugin.search.extensions().includes("md"), "the extensions on offer come from the vault");
assert.ok(plugin.search.tags().includes("project/alpha"), "the tags on offer come from the cache");

// The cap reports what it left out.
const capped = plugin.search.search("", { kind: "any", extension: null, age: "any", tag: null }, 2);
assert.equal(capped.files.length, 2, "the cap should hold");
assert.ok(capped.total > 2, "the total should count what was left out");

console.log("search: ok");

// --- The dialog, and what choosing does --------------------------------------

view.renderer.collapseAll();
view.promptSearch();
const finder = openedModals.at(-1);
assert.equal(
	finder.modalEl.querySelectorAll(".treenav-search-filter").length,
	4,
	"kind, extension, age and tag",
);

finder.type("old note");
assert.equal(finder.rendered.length, 1, "one match for that name");
assert.equal(
	finder.resultContainerEl.querySelector(".treenav-search-path").textContent,
	"Archive/2024/Q1",
	"a result should say where it lives",
);

// Choosing opens the file, and the tree follows it wherever it was.
const chosen = finder.rendered[0];
activeFile = chosen;
finder.onChooseSuggestion(chosen);
await new Promise((resolve) => setTimeout(resolve, 5));

assert.ok(view.renderer.getItem(chosen.path), "choosing should open the folders in the way");
assert.equal(view.renderer.getSelected()?.path, chosen.path, "and land on the row");
activeFile = null;

console.log("find dialog: ok");

console.log("\nsmoke test passed");
