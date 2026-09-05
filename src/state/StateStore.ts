import { debounce } from "obsidian";
import {
	DATA_VERSION,
	DEFAULT_SETTINGS,
	TreeNavData,
	TreeNavSettings,
	TreeNavStyle,
} from "../types";
import { isSameOrDescendant, parentPath, remapPath } from "./paths";

interface PersistHost {
	loadData(): Promise<unknown>;
	saveData(data: TreeNavData): Promise<void>;
}

/**
 * Owns everything TreeNav persists: user settings plus the path-keyed state.
 *
 * Obsidian gives no stable identifier for a file, so path-keyed state has to be
 * migrated by hand whenever something is renamed or moved. A folder rename only
 * emits a single event for the folder itself, hence the prefix rewrite — which
 * every path-keyed map goes through together.
 */
export class StateStore {
	settings: TreeNavSettings = { ...DEFAULT_SETTINGS };

	private expanded = new Set<string>();
	private styles = new Map<string, TreeNavStyle>();
	private order = new Map<string, number>();
	private nested = new Set<string>();
	private readonly scheduleSave = debounce(() => void this.save(), 400, false);

	constructor(private readonly host: PersistHost) {}

	async load(): Promise<void> {
		const raw = (await this.host.loadData()) as Partial<TreeNavData> | null;
		if (!raw) return;

		this.settings = { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) };
		if (this.settings.rememberExpandedFolders && Array.isArray(raw.expandedFolders)) {
			this.expanded = new Set(raw.expandedFolders);
		}
		if (raw.styles) {
			this.styles = new Map(Object.entries(raw.styles));
		}
		if (raw.order) {
			this.order = new Map(Object.entries(raw.order));
		}
		if (Array.isArray(raw.nestedFolders)) {
			this.nested = new Set(raw.nestedFolders);
		}
	}

	async save(): Promise<void> {
		const data: TreeNavData = {
			version: DATA_VERSION,
			settings: this.settings,
			expandedFolders: this.settings.rememberExpandedFolders ? [...this.expanded] : [],
			styles: Object.fromEntries(this.styles),
			order: Object.fromEntries(this.order),
			nestedFolders: [...this.nested],
		};
		await this.host.saveData(data);
	}

	// --- Expanded folders --------------------------------------------------

	isExpanded(path: string): boolean {
		return this.expanded.has(path);
	}

	setExpanded(path: string, expanded: boolean): void {
		if (expanded) this.expanded.add(path);
		else this.expanded.delete(path);
		this.scheduleSave();
	}

	// --- Styles ------------------------------------------------------------

	getStyle(path: string): TreeNavStyle | undefined {
		return this.styles.get(path);
	}

	hasStyle(path: string): boolean {
		return this.styles.has(path);
	}

	/** Merges `patch` into the item's style; `undefined` fields clear a property. */
	setStyle(path: string, patch: Partial<TreeNavStyle>): void {
		const next: TreeNavStyle = { ...this.styles.get(path), ...patch };

		for (const key of Object.keys(next) as (keyof TreeNavStyle)[]) {
			if (next[key] === undefined) delete next[key];
		}

		if (Object.keys(next).length === 0) this.styles.delete(path);
		else this.styles.set(path, next);

		this.scheduleSave();
	}

	clearStyle(path: string): void {
		if (!this.styles.delete(path)) return;
		this.scheduleSave();
	}

	// --- Manual order ------------------------------------------------------

	/** Position of an item inside its folder, or `undefined` when unordered. */
	getOrder(path: string): number | undefined {
		return this.order.get(path);
	}

	/** Replaces a folder's order with `childPaths`, which must be the full listing. */
	setOrder(childPaths: string[]): void {
		childPaths.forEach((path, index) => this.order.set(path, index));
		this.scheduleSave();
	}

	hasOrder(folderPath: string): boolean {
		for (const path of this.order.keys()) {
			if (parentPath(path) === folderPath) return true;
		}
		return false;
	}

	/** Drops the manual order of one folder, returning it to sorted order. */
	clearOrder(folderPath: string): void {
		let changed = false;
		for (const path of [...this.order.keys()]) {
			if (parentPath(path) !== folderPath) continue;
			this.order.delete(path);
			changed = true;
		}
		if (changed) this.scheduleSave();
	}

	// --- Folders created by nesting ----------------------------------------

	isNested(folderPath: string): boolean {
		return this.nested.has(folderPath);
	}

	markNested(folderPath: string): void {
		this.nested.add(folderPath);
		this.scheduleSave();
	}

	unmarkNested(folderPath: string): void {
		if (!this.nested.delete(folderPath)) return;
		this.scheduleSave();
	}

	/**
	 * Copies one item's appearance and position onto another path.
	 *
	 * Nesting turns `A.md` into the folder `A`, and the folder's row takes over
	 * the place the note's row held. Without this the folder would be an item
	 * the store has never seen: unstyled, and unpositioned so it falls to the
	 * bottom of a manually ordered folder. The note keeps its own entries, so
	 * flattening restores it exactly.
	 */
	inherit(fromPath: string, toPath: string): void {
		const style = this.styles.get(fromPath);
		if (style) this.styles.set(toPath, { ...style });

		const index = this.order.get(fromPath);
		if (index !== undefined) this.order.set(toPath, index);

		if (style || index !== undefined) this.scheduleSave();
	}

	// --- Path migration ----------------------------------------------------

	/** Applies a rename/move to every path-keyed entry. */
	handleRename(oldPath: string, newPath: string): void {
		let changed = false;

		for (const path of [...this.expanded]) {
			const next = remapPath(path, oldPath, newPath);
			if (next === null) continue;
			this.expanded.delete(path);
			this.expanded.add(next);
			changed = true;
		}

		for (const [path, style] of [...this.styles]) {
			const next = remapPath(path, oldPath, newPath);
			if (next === null) continue;
			this.styles.delete(path);
			this.styles.set(next, style);
			changed = true;
		}

		for (const [path, index] of [...this.order]) {
			const next = remapPath(path, oldPath, newPath);
			if (next === null) continue;
			this.order.delete(path);
			this.order.set(next, index);
			changed = true;
		}

		for (const path of [...this.nested]) {
			const next = remapPath(path, oldPath, newPath);
			if (next === null) continue;
			this.nested.delete(path);
			this.nested.add(next);
			changed = true;
		}

		if (changed) this.scheduleSave();
	}

	/** Drops path-keyed entries for a deleted item and everything under it. */
	handleDelete(path: string): void {
		let changed = false;

		for (const entry of [...this.expanded]) {
			if (!isSameOrDescendant(entry, path)) continue;
			this.expanded.delete(entry);
			changed = true;
		}

		for (const entry of [...this.styles.keys()]) {
			if (!isSameOrDescendant(entry, path)) continue;
			this.styles.delete(entry);
			changed = true;
		}

		for (const entry of [...this.order.keys()]) {
			if (!isSameOrDescendant(entry, path)) continue;
			this.order.delete(entry);
			changed = true;
		}

		for (const entry of [...this.nested]) {
			if (!isSameOrDescendant(entry, path)) continue;
			this.nested.delete(entry);
			changed = true;
		}

		if (changed) this.scheduleSave();
	}
}
