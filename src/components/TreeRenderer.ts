import { App, TAbstractFile, TFile, TFolder } from "obsidian";
import { DragDropService } from "../services/DragDropService";
import { FolderNoteService } from "../services/FolderNoteService";
import { StyleService } from "../services/StyleService";
import { TreeService } from "../services/TreeService";
import { StateStore } from "../state/StateStore";
import { parentPath } from "../state/paths";
import { TreeContext, TreeItem } from "./TreeItem";

export interface TreeRendererHost {
	onItemClick(item: TreeItem, event: MouseEvent): void;
	onItemContextMenu(item: TreeItem, event: MouseEvent): void;
}

/** Path used for the vault root throughout the renderer. */
const ROOT = "/";

/**
 * Owns the rendered tree: the path -> row registry, partial re-rendering and
 * the active/selected markers.
 *
 * Vault events arrive one at a time (a paste can produce dozens), so refresh
 * requests are collected per parent folder and flushed once per frame.
 */
export class TreeRenderer implements TreeContext {
	private readonly itemsByPath = new Map<string, TreeItem>();
	private rootChildren: TreeItem[] = [];

	private selectedPath: string | null = null;
	private activePath: string | null = null;
	private activeFolderPath: string | null = null;

	private pending = new Set<string>();
	private frame: number | null = null;

	constructor(
		readonly app: App,
		private readonly containerEl: HTMLElement,
		private readonly tree: TreeService,
		private readonly folderNotes: FolderNoteService,
		readonly dnd: DragDropService,
		readonly styles: StyleService,
		private readonly state: StateStore,
		private readonly host: TreeRendererHost,
	) {
		this.dnd.attachRootTarget(this.containerEl);
	}

	// --- TreeContext -------------------------------------------------------

	getVisibleChildren(folder: TFolder): TAbstractFile[] {
		return this.tree.getVisibleChildren(folder);
	}

	isExpanded(path: string): boolean {
		return this.state.isExpanded(path);
	}

	setExpanded(path: string, expanded: boolean): void {
		this.state.setExpanded(path, expanded);
	}

	registerItem(item: TreeItem): void {
		// The key is captured on registration: a rename mutates `item.path` in
		// place, and the row still has to be removable under its original key.
		item.registryKey = item.path;
		this.itemsByPath.set(item.registryKey, item);
		if (item.path === this.selectedPath) item.setSelected(true);
	}

	unregisterItem(item: TreeItem): void {
		if (this.itemsByPath.get(item.registryKey) === item) {
			this.itemsByPath.delete(item.registryKey);
		}
	}

	isActive(path: string): boolean {
		return path === this.activePath || path === this.activeFolderPath;
	}

	handleClick(item: TreeItem, event: MouseEvent): void {
		this.select(item);
		this.host.onItemClick(item, event);
	}

	handleContextMenu(item: TreeItem, event: MouseEvent): void {
		this.select(item);
		this.host.onItemContextMenu(item, event);
	}

	// --- Rendering ---------------------------------------------------------

	render(): void {
		this.destroyRootChildren();
		const root = this.app.vault.getRoot();
		for (const child of this.tree.getVisibleChildren(root)) {
			this.rootChildren.push(new TreeItem(this, child, 0, this.containerEl));
		}
	}

	/** Queues a rebuild of the children of `folderPath` (use `/` for the root). */
	scheduleRefresh(folderPath: string): void {
		this.pending.add(folderPath);
		if (this.frame !== null) return;
		this.frame = window.requestAnimationFrame(() => {
			this.frame = null;
			this.flush();
		});
	}

	/** Applies queued refreshes immediately. */
	flush(): void {
		if (this.frame !== null) {
			window.cancelAnimationFrame(this.frame);
			this.frame = null;
		}
		if (this.pending.size === 0) return;

		const paths = [...this.pending];
		this.pending.clear();

		// A rebuilt ancestor already rebuilds its descendants.
		const targets = paths.filter(
			(path) => !paths.some((other) => other !== path && isStrictAncestor(other, path)),
		);

		for (const path of targets) {
			if (path === ROOT) {
				this.render();
				continue;
			}
			this.itemsByPath.get(path)?.refresh();
		}
	}

	getItem(path: string): TreeItem | undefined {
		return this.itemsByPath.get(path);
	}

	/** Re-applies the stored style to one row, leaving the rest of the tree alone. */
	applyStyle(path: string): void {
		this.itemsByPath.get(path)?.applyStyle();
	}

	/** Re-applies every stored style; used when an appearance setting changes. */
	applyAllStyles(): void {
		for (const item of this.itemsByPath.values()) item.applyStyle();
	}

	/** Rows in the order they appear on screen — the axis keyboard navigation moves along. */
	getVisibleItems(): TreeItem[] {
		const ordered: TreeItem[] = [];
		const walk = (items: TreeItem[]) => {
			for (const item of items) {
				ordered.push(item);
				if (item.isExpanded) walk(item.children);
			}
		};
		walk(this.rootChildren);
		return ordered;
	}

	getParentItem(item: TreeItem): TreeItem | undefined {
		const parent = parentPath(item.path);
		return parent === ROOT ? undefined : this.itemsByPath.get(parent);
	}

	/** Expands every ancestor of `path` so its row exists, then returns it. */
	reveal(path: string): TreeItem | undefined {
		const segments = path.split("/");
		let current = "";
		for (let i = 0; i < segments.length - 1; i += 1) {
			current = current ? `${current}/${segments[i]}` : segments[i];
			this.itemsByPath.get(current)?.setExpanded(true);
		}
		const item = this.itemsByPath.get(path);
		item?.rowEl.scrollIntoView({ block: "nearest" });
		return item;
	}

	// --- Selection / active file ------------------------------------------

	select(item: TreeItem | null): void {
		if (this.selectedPath) this.itemsByPath.get(this.selectedPath)?.setSelected(false);
		this.selectedPath = item?.path ?? null;
		item?.setSelected(true);
	}

	/** Collapses every expanded folder, deepest first so no state is left behind. */
	collapseAll(): void {
		const walk = (items: TreeItem[]) => {
			for (const item of items) {
				if (!item.isFolder || !item.isExpanded) continue;
				walk(item.children);
				item.setExpanded(false);
			}
		};
		walk(this.rootChildren);
	}

	getSelected(): TreeItem | null {
		return this.selectedPath ? this.itemsByPath.get(this.selectedPath) ?? null : null;
	}

	setActiveFile(file: TFile | null): void {
		const previous = [this.activePath, this.activeFolderPath];

		this.activePath = file?.path ?? null;
		// A hidden folder note highlights its folder instead of nothing.
		this.activeFolderPath =
			file && this.folderNotes.isFolderNote(file) ? parentPath(file.path) : null;

		for (const path of [...previous, this.activePath, this.activeFolderPath]) {
			if (path) this.itemsByPath.get(path)?.updateActive();
		}
	}

	/** Drops selection state for a path that no longer exists. */
	forgetSelection(path: string): void {
		if (this.selectedPath === path) this.selectedPath = null;
	}

	destroy(): void {
		if (this.frame !== null) window.cancelAnimationFrame(this.frame);
		this.frame = null;
		this.pending.clear();
		this.destroyRootChildren();
	}

	private destroyRootChildren(): void {
		for (const child of this.rootChildren) child.destroy();
		this.rootChildren = [];
		this.containerEl.empty();
	}
}

function isStrictAncestor(ancestor: string, path: string): boolean {
	if (ancestor === path) return false;
	if (ancestor === ROOT) return true;
	return path.startsWith(ancestor + "/");
}
