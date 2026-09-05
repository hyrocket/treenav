import { TAbstractFile, TFile, TFolder, setIcon } from "obsidian";
import { DragDropService, DropMode, DropTargetRow } from "../services/DragDropService";
import { StyleService } from "../services/StyleService";

/** Everything a row needs from its owning tree. Implemented by TreeRenderer. */
export interface TreeContext {
	dnd: DragDropService;
	styles: StyleService;
	getVisibleChildren(folder: TFolder): TAbstractFile[];
	isExpanded(path: string): boolean;
	setExpanded(path: string, expanded: boolean): void;
	registerItem(item: TreeItem): void;
	unregisterItem(item: TreeItem): void;
	isActive(path: string): boolean;
	handleClick(item: TreeItem, event: MouseEvent): void;
	handleContextMenu(item: TreeItem, event: MouseEvent): void;
}

/**
 * One row of the tree, owning its own DOM subtree.
 *
 * A collapsed folder holds no child DOM at all: expanding builds it, collapsing
 * destroys it. That keeps the rendered node count proportional to what is
 * visible rather than to the size of the vault.
 */
export class TreeItem implements DropTargetRow {
	readonly el: HTMLElement;
	readonly rowEl: HTMLElement;
	readonly titleEl: HTMLElement;
	readonly iconEl: HTMLElement;
	readonly isFolder: boolean;

	children: TreeItem[] = [];

	/** Key this row is filed under in the renderer registry. Owned by TreeRenderer. */
	registryKey = "";

	private childrenEl: HTMLElement | null = null;
	private dropMode: DropMode | null = null;
	private expanded = false;

	constructor(
		private readonly ctx: TreeContext,
		readonly file: TAbstractFile,
		readonly depth: number,
		parentEl: HTMLElement,
	) {
		this.isFolder = file instanceof TFolder;

		this.el = parentEl.createDiv({
			cls: this.isFolder ? "treenav-item treenav-folder" : "treenav-item treenav-file",
		});

		this.el.style.setProperty("--treenav-depth", String(depth));

		this.rowEl = this.el.createDiv({ cls: "treenav-item-self" });
		this.rowEl.setAttribute("data-path", file.path);

		const collapseEl = this.rowEl.createDiv({ cls: "treenav-collapse-icon" });
		if (this.isFolder) {
			setIcon(collapseEl, "chevron-right");
			collapseEl.addEventListener("click", (event) => {
				event.stopPropagation();
				this.toggle();
			});
		}

		// The icon slot is always present, even when empty: a row that has an
		// icon must not push its title out of line with the rows around it.
		this.iconEl = this.rowEl.createDiv({ cls: "treenav-item-icon" });

		this.titleEl = this.rowEl.createDiv({ cls: "treenav-item-title", text: this.displayName });

		this.rowEl.addEventListener("click", (event) => this.ctx.handleClick(this, event));
		this.rowEl.addEventListener("contextmenu", (event) => this.ctx.handleContextMenu(this, event));

		this.ctx.dnd.makeDraggable(this.rowEl, () => this.file);
		this.ctx.dnd.attachRow(this);

		this.ctx.registerItem(this);
		this.applyStyle();
		this.updateActive();
		this.updateLeafState();

		if (this.isFolder && this.ctx.isExpanded(this.path)) {
			this.setExpanded(true, false);
		}
	}

	get path(): string {
		return this.file.path;
	}

	/** Markdown notes are listed without their extension, like the core explorer. */
	get displayName(): string {
		if (this.file instanceof TFile && this.file.extension === "md") return this.file.basename;
		return this.file.name;
	}

	get isExpanded(): boolean {
		return this.expanded;
	}

	toggle(): void {
		this.setExpanded(!this.expanded);
	}

	setExpanded(expanded: boolean, persist = true): void {
		if (!this.isFolder || expanded === this.expanded) return;
		this.expanded = expanded;
		this.el.toggleClass("treenav-is-expanded", expanded);

		if (expanded) this.buildChildren();
		else this.destroyChildren();

		if (persist) this.ctx.setExpanded(this.path, expanded);
	}

	/**
	 * Re-reads this folder's listing. The collapse arrow is refreshed even while
	 * collapsed, so a folder that just lost its last child stops advertising one.
	 */
	refresh(): void {
		this.updateLeafState();
		if (!this.expanded) return;
		this.destroyChildren();
		this.buildChildren();
	}

	/** Paints the pending drop: an insertion line, or a highlight on the target. */
	showDropIndicator(mode: DropMode | null): void {
		if (this.dropMode === mode) return;
		this.dropMode = mode;

		this.rowEl.toggleClass("treenav-drop-into", mode === "into");
		this.rowEl.toggleClass("treenav-drop-nest", mode === "nest");
		this.rowEl.toggleClass("treenav-drop-before", mode === "before");
		this.rowEl.toggleClass("treenav-drop-after", mode === "after");

		// Nesting swaps the icon for the action it would perform.
		if (mode === "nest") {
			this.iconEl.empty();
			setIcon(this.iconEl, "folder-plus");
		} else {
			this.ctx.styles.applyToIcon(this.iconEl, this.file);
		}
	}

	applyStyle(): void {
		this.ctx.styles.applyToRow(this.rowEl, this.path);
		this.ctx.styles.applyToIcon(this.iconEl, this.file);
	}

	/** A folder with nothing to show is drawn without a collapse arrow. */
	private updateLeafState(): void {
		const empty =
			!this.isFolder ||
			this.ctx.getVisibleChildren(this.file as TFolder).length === 0;
		this.el.toggleClass("treenav-is-leaf", empty);
	}

	setSelected(selected: boolean): void {
		this.rowEl.toggleClass("treenav-is-selected", selected);
	}

	updateActive(): void {
		this.rowEl.toggleClass("treenav-is-active", this.ctx.isActive(this.path));
	}

	scrollIntoView(): void {
		this.rowEl.scrollIntoView({ block: "nearest" });
	}

	/** Removes this row and everything under it, unregistering as it goes. */
	destroy(): void {
		this.destroyChildren();
		this.ctx.unregisterItem(this);
		this.el.detach();
	}

	private buildChildren(): void {
		if (!(this.file instanceof TFolder)) return;
		this.childrenEl = this.el.createDiv({ cls: "treenav-children" });
		for (const child of this.ctx.getVisibleChildren(this.file)) {
			this.children.push(new TreeItem(this.ctx, child, this.depth + 1, this.childrenEl));
		}
		this.updateLeafState();
	}

	private destroyChildren(): void {
		for (const child of this.children) child.destroy();
		this.children = [];
		this.childrenEl?.detach();
		this.childrenEl = null;
	}
}
