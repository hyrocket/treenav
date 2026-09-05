import {
	ItemView,
	Keymap,
	Menu,
	Notice,
	TAbstractFile,
	TFile,
	TFolder,
	WorkspaceLeaf,
	setIcon,
} from "obsidian";
import type TreeNavPlugin from "../main";
import { ConfirmModal } from "../components/ConfirmModal";
import { AppearanceModal } from "../components/AppearanceModal";
import { FolderSuggestModal } from "../components/FolderSuggestModal";
import { IconPickerModal } from "../components/IconPickerModal";
import { startInlineRename } from "../components/InlineRename";
import { TreeItem } from "../components/TreeItem";
import { TreeRenderer, TreeRendererHost } from "../components/TreeRenderer";
import { parentPath } from "../state/paths";
import { TREENAV_ICON, TREENAV_VIEW_TYPE, TreeNavStyle } from "../types";
import { OutlineEdge } from "../services/OutlineService";
import { TreeKeymap, TreeKeymapActions } from "./TreeKeymap";

export class TreeNavView extends ItemView implements TreeRendererHost, TreeKeymapActions {
	private renderer: TreeRenderer | null = null;
	private keymap: TreeKeymap | null = null;
	private treeEl: HTMLElement | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: TreeNavPlugin,
	) {
		super(leaf);
		this.navigation = false;
	}

	getViewType(): string {
		return TREENAV_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "TreeNav";
	}

	getIcon(): string {
		return TREENAV_ICON;
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("treenav-view");

		this.buildHeader(container);

		const treeEl = container.createDiv({ cls: "treenav-tree" });
		treeEl.tabIndex = 0;
		this.treeEl = treeEl;
		this.applyTreeStyle();

		this.renderer = new TreeRenderer(
			this.app,
			treeEl,
			this.plugin.treeService,
			this.plugin.folderNotes,
			this.plugin.dnd,
			this.plugin.styles,
			this.plugin.state,
			this,
		);
		this.keymap = new TreeKeymap(this.renderer, this);

		this.renderer.render();
		this.renderer.setActiveFile(this.app.workspace.getActiveFile());

		treeEl.addEventListener("click", (event) => {
			if (event.target === treeEl) this.renderer?.select(null);
		});
		treeEl.addEventListener("contextmenu", (event) => {
			if (event.target === treeEl) this.showRootMenu(event);
		});
		treeEl.addEventListener("keydown", (event) => this.handleKeyDown(event));

		// Dragging a selected row takes the whole selection; dragging anything
		// else replaces the selection first, so what moves is what is lit up.
		//
		// The drag layer is shared by every open TreeNav, so the tree the drag
		// started in claims it here — in the capture phase, before the row's own
		// handler asks for the set.
		treeEl.addEventListener(
			"dragstart",
			() => {
				this.plugin.dnd.resolveDragSet = (file) => this.dragSetFor(file);
				this.plugin.dnd.rowFor = (file) => this.renderer?.getItem(file.path)?.rowEl ?? null;
			},
			true,
		);

		this.registerVaultEvents();
	}

	async onClose(): Promise<void> {
		this.renderer?.destroy();
		this.renderer = null;
		this.keymap = null;
		this.treeEl = null;
	}

	/** Full re-render; used when a setting changes the tree contents or order. */
	rebuild(): void {
		this.applyTreeStyle();
		this.renderer?.render();
		this.renderer?.setActiveFile(this.app.workspace.getActiveFile());
	}

	/** Switches between flat indentation and classic connector lines. */
	applyTreeStyle(): void {
		const classic = this.plugin.state.settings.treeStyle === "classic";
		this.treeEl?.toggleClass("treenav-style-classic", classic);
	}

	/** Re-renders one folder's listing, for changes no vault event reports. */
	refreshFolder(folderPath: string): void {
		this.renderer?.scheduleRefresh(folderPath);
	}

	/** Repaints stored styles without rebuilding the tree. */
	refreshStyles(path?: string): void {
		if (path) this.renderer?.applyStyle(path);
		else this.renderer?.applyAllStyles();
	}

	// --- Wiring ------------------------------------------------------------

	private buildHeader(container: HTMLElement): void {
		const header = container.createDiv({ cls: "nav-header treenav-header" });
		const actions = header.createDiv({ cls: "nav-buttons-container" });

		const button = (icon: string, label: string, onClick: () => void) => {
			const el = actions.createDiv({ cls: "clickable-icon nav-action-button" });
			el.setAttribute("aria-label", label);
			setIcon(el, icon);
			el.addEventListener("click", onClick);
		};

		button("file-plus", "New note", () => void this.createNote(this.getTargetFolder()));
		button("folder-plus", "New folder", () => void this.createFolder(this.getTargetFolder()));
		button("chevrons-down-up", "Collapse all", () => this.renderer?.collapseAll());
	}

	private registerVaultEvents(): void {
		const { vault } = this.app;

		this.registerEvent(
			vault.on("create", (file) => this.renderer?.scheduleRefresh(parentPath(file.path))),
		);
		this.registerEvent(
			vault.on("delete", (file) => {
				this.renderer?.forgetSelection(file.path);
				this.renderer?.scheduleRefresh(parentPath(file.path));
			}),
		);
		this.registerEvent(
			vault.on("rename", (file, oldPath) => {
				this.renderer?.forgetSelection(oldPath);
				// The active file keeps its identity across a rename but not its
				// path, so the highlight has to be re-pointed.
				this.renderer?.setActiveFile(this.app.workspace.getActiveFile());
				this.renderer?.scheduleRefresh(parentPath(oldPath));
				this.renderer?.scheduleRefresh(parentPath(file.path));
			}),
		);
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => this.renderer?.setActiveFile(file)),
		);
	}

	private handleKeyDown(event: KeyboardEvent): void {
		this.keymap?.handle(event);
	}

	// --- TreeKeymapActions -------------------------------------------------

	openItem(item: TreeItem): void {
		if (item.file instanceof TFolder) {
			void this.openFolderNote(item.file, null, true);
			return;
		}
		void this.openFile(item.file as TFile, null, true);
	}

	renameItem(item: TreeItem): void {
		this.startRename(item);
	}

	deleteItem(item: TreeItem): void {
		const files = this.selectionFor(item);
		if (files.length > 1) this.confirmDeleteAll(files);
		else this.confirmDelete(item.file);
	}

	createNoteIn(folder: TFolder): void {
		void this.createNote(folder);
	}

	createFolderIn(folder: TFolder): void {
		void this.createFolder(folder);
	}

	moveStep(item: TreeItem, delta: -1 | 1): void {
		this.runOutline(item, () => this.plugin.outline.moveStep(item.file, delta));
	}

	moveToEdge(item: TreeItem, edge: OutlineEdge): void {
		this.runOutline(item, () => this.plugin.outline.moveToEdge(item.file, edge));
	}

	indentItem(item: TreeItem): void {
		this.runOutline(item, () => this.plugin.outline.indent(item.file));
	}

	outdentItem(item: TreeItem): void {
		this.runOutline(item, () => this.plugin.outline.outdent(item.file));
	}

	// --- Commands ----------------------------------------------------------

	/** True while this view holds keyboard focus; gates the plugin's commands. */
	hasFocus(): boolean {
		return !!this.treeEl && this.treeEl.contains(document.activeElement);
	}

	/** Runs `action` on the selected row, if there is one. */
	withSelected(action: (item: TreeItem) => void): void {
		const item = this.renderer?.getSelected();
		if (item) action(item);
	}

	newNote(): void {
		void this.createNote(this.getTargetFolder());
	}

	newFolder(): void {
		void this.createFolder(this.getTargetFolder());
	}

	/**
	 * Runs a move, then puts the selection back on the item wherever it landed.
	 * `file` is mutated in place by a move, so its path is current afterwards.
	 */
	private runOutline(item: TreeItem, run: () => void | Promise<void>): void {
		const file = item.file;
		void (async () => {
			await run();
			const moved = await this.revealChanged(file.path);
			if (moved) this.renderer?.select(moved);
			this.treeEl?.focus();
		})();
	}

	// --- TreeRendererHost --------------------------------------------------

	onItemClick(item: TreeItem, event: MouseEvent): void {
		this.treeEl?.focus();

		if (!item.isFolder) {
			void this.openFile(item.file as TFile, event);
			return;
		}

		const folder = item.file as TFolder;
		const settings = this.plugin.state.settings;

		if (settings.openFolderNoteOnClick) {
			const note = this.plugin.folderNotes.getFolderNote(folder);
			if (note) {
				item.setExpanded(true);
				void this.openFile(note, event);
				return;
			}
			if (settings.autoCreateFolderNote) {
				item.setExpanded(true);
				void this.openFolderNote(folder, event);
				return;
			}
		}

		item.toggle();
	}

	/** A modifier click only moves the selection around; nothing is opened. */
	onSelectionClick(_item: TreeItem): void {
		this.treeEl?.focus();
	}

	/** Middle click opens in a new tab, the gesture the modifier used to be. */
	onItemAuxClick(item: TreeItem, event: MouseEvent): void {
		this.treeEl?.focus();
		if (event.button !== 1) return;

		const file = item.file;
		if (file instanceof TFile) {
			void this.app.workspace.getLeaf("tab").openFile(file);
			return;
		}
		const note = this.plugin.folderNotes.getFolderNote(file as TFolder);
		if (note) void this.app.workspace.getLeaf("tab").openFile(note);
	}

	/**
	 * What a drag starting on `file` should carry: the selection when the row is
	 * part of it, otherwise that row alone, which then becomes the selection.
	 */
	private dragSetFor(file: TAbstractFile): TAbstractFile[] {
		const renderer = this.renderer;
		if (!renderer) return [file];

		if (!renderer.isSelected(file.path)) {
			const item = renderer.getItem(file.path);
			if (item) renderer.select(item);
			return [file];
		}
		return renderer.getSelection().map((item) => item.file);
	}

	/** The rows an action applies to: the whole selection when `item` is in it. */
	private selectionFor(item: TreeItem): TAbstractFile[] {
		const selection = this.renderer?.getSelection() ?? [];
		if (selection.length > 1 && selection.some((row) => row.path === item.path)) {
			return selection.map((row) => row.file);
		}
		return [item.file];
	}

	onItemContextMenu(item: TreeItem, event: MouseEvent): void {
		event.preventDefault();

		const files = this.selectionFor(item);
		if (files.length > 1) {
			this.showSelectionMenu(files, event);
			return;
		}

		const file = item.file;
		const folder = file instanceof TFolder ? file : file.parent ?? this.app.vault.getRoot();
		const menu = new Menu();

		if (file instanceof TFile) {
			menu.addItem((entry) =>
				entry
					.setTitle("Open")
					.setIcon("file")
					.onClick(() => void this.openFile(file, null, true)),
			);
			menu.addItem((entry) =>
				entry
					.setTitle("Open in new tab")
					.setIcon("file-plus")
					.onClick(() => void this.app.workspace.getLeaf("tab").openFile(file)),
			);
		} else {
			const note = this.plugin.folderNotes.getFolderNote(file as TFolder);
			menu.addItem((entry) =>
				entry
					.setTitle(note ? "Open folder note" : "Create folder note")
					.setIcon("book-open")
					.onClick(() => void this.openFolderNote(file as TFolder, null, true)),
			);
		}

		menu.addSeparator();
		menu.addItem((entry) =>
			entry
				.setTitle("New note")
				.setIcon("file-plus")
				.onClick(() => void this.createNote(folder)),
		);
		menu.addItem((entry) =>
			entry
				.setTitle("New folder")
				.setIcon("folder-plus")
				.onClick(() => void this.createFolder(folder)),
		);

		menu.addItem((entry) =>
			entry
				.setTitle("Move to…")
				.setIcon("folder-input")
				.onClick(() => this.promptMove(file)),
		);

		this.addResetOrderItem(menu, folder);

		menu.addSeparator();
		this.addOutlineItems(menu, item);

		menu.addSeparator();
		this.addStyleItems(menu, item);

		menu.addSeparator();
		menu.addItem((entry) =>
			entry
				.setTitle("Rename")
				.setIcon("pencil")
				.onClick(() => this.startRename(item)),
		);
		menu.addItem((entry) =>
			entry
				.setTitle("Delete")
				.setIcon("trash")
				.onClick(() => this.confirmDelete(file)),
		);

		// Lets other plugins contribute entries, as they do for the core explorer.
		this.app.workspace.trigger("file-menu", menu, file, "treenav", this.leaf);
		menu.showAtMouseEvent(event);
	}

	/**
	 * The menu for a multi-row selection: only what makes sense done to a set.
	 * Renaming, folder notes and the outline moves are all about one row, so
	 * they are left out rather than quietly applied to the first one.
	 */
	private showSelectionMenu(files: TAbstractFile[], event: MouseEvent): void {
		const menu = new Menu();
		const count = `${files.length} items`;

		menu.addItem((entry) =>
			entry
				.setTitle(`Move ${count} to…`)
				.setIcon("folder-input")
				.onClick(() => this.promptMoveAll(files)),
		);
		menu.addItem((entry) =>
			entry
				.setTitle(`Font & color — ${count}`)
				.setIcon("palette")
				.onClick(() => this.promptAppearanceOf(files)),
		);
		menu.addSeparator();
		menu.addItem((entry) =>
			entry
				.setTitle(`Delete ${count}`)
				.setIcon("trash")
				.onClick(() => this.confirmDeleteAll(files)),
		);

		menu.showAtMouseEvent(event);
	}

	/** The keyboard moves, spelled out for people who reach for the mouse. */
	private addOutlineItems(menu: Menu, item: TreeItem): void {
		const moves: { title: string; icon: string; run: () => void }[] = [
			{ title: "Move up", icon: "chevron-up", run: () => this.moveStep(item, -1) },
			{ title: "Move down", icon: "chevron-down", run: () => this.moveStep(item, 1) },
			{ title: "Move to top", icon: "chevrons-up", run: () => this.moveToEdge(item, "top") },
			{
				title: "Move to bottom",
				icon: "chevrons-down",
				run: () => this.moveToEdge(item, "bottom"),
			},
			{ title: "Indent", icon: "indent-increase", run: () => this.indentItem(item) },
			{ title: "Outdent", icon: "indent-decrease", run: () => this.outdentItem(item) },
		];

		for (const move of moves) {
			menu.addItem((entry) => entry.setTitle(move.title).setIcon(move.icon).onClick(move.run));
		}
	}

	/**
	 * Offered only where it applies: a folder keeps a manual order once its
	 * children have been dragged into place.
	 */
	private addResetOrderItem(menu: Menu, folder: TFolder): void {
		if (!this.plugin.state.hasOrder(folder.path)) return;

		menu.addItem((entry) =>
			entry
				.setTitle("Reset manual order")
				.setIcon("arrow-down-up")
				.onClick(() => {
					this.plugin.state.clearOrder(folder.path);
					this.refreshFolder(folder.path);
				}),
		);
	}

	/** Keyboard- and menu-reachable alternative to dragging an item. */
	private promptMove(file: TAbstractFile): void {
		new FolderSuggestModal(
			this.app,
			(folder) => this.plugin.fileOps.checkMove(file, folder) !== null || folder === file.parent,
			(folder) => void this.plugin.fileOps.move(file, folder),
		).open();
	}

	/** A folder is offered if it would take any of them; the rest stay put. */
	private promptMoveAll(files: TAbstractFile[]): void {
		new FolderSuggestModal(
			this.app,
			(folder) =>
				files.every(
					(file) => this.plugin.fileOps.checkMove(file, folder) !== null || folder === file.parent,
				),
			(folder) => void this.moveAll(files, folder),
		).open();
	}

	/** One at a time: two moves at once can race for the same name. */
	private async moveAll(files: TAbstractFile[], folder: TFolder): Promise<void> {
		for (const file of files) {
			if (file.parent !== folder) await this.plugin.fileOps.move(file, folder);
		}
	}

	// --- Appearance --------------------------------------------------------

	/** The quick path: the icon alone, without opening the whole dialog. */
	promptIcon(item: TreeItem): void {
		new IconPickerModal(this.app, this.plugin.styles.get(item.path)?.icon, (icon) =>
			this.applyStyle(item.path, { icon }),
		).open();
	}

	/** One dialog, previewed on the first row, applied to all of them. */
	private promptAppearanceOf(files: TAbstractFile[]): void {
		const first = files[0];
		new AppearanceModal(
			this.app,
			first,
			`${files.length} items`,
			this.plugin.styles,
			(style) => {
				for (const file of files) this.applyStyle(file.path, style);
			},
		).open();
	}

	promptAppearance(item: TreeItem): void {
		new AppearanceModal(
			this.app,
			item.file,
			item.displayName,
			this.plugin.styles,
			(style) => this.applyStyle(item.path, style),
		).open();
	}

	private addStyleItems(menu: Menu, item: TreeItem): void {
		const path = item.path;
		const styles = this.plugin.styles;

		menu.addItem((entry) =>
			entry
				.setTitle("Set icon")
				.setIcon("image")
				.onClick(() => this.promptIcon(item)),
		);

		menu.addItem((entry) =>
			entry
				.setTitle("Font & color")
				.setIcon("palette")
				.onClick(() => this.promptAppearance(item)),
		);

		if (styles.has(path)) {
			menu.addItem((entry) =>
				entry
					.setTitle("Reset appearance")
					.setIcon("rotate-ccw")
					.onClick(() => {
						styles.clear(path);
						this.plugin.refreshStyles(path);
					}),
			);
		}
	}

	private applyStyle(path: string, patch: Partial<TreeNavStyle>): void {
		this.plugin.styles.update(path, patch);
		this.plugin.refreshStyles(path);
	}

	// --- Actions -----------------------------------------------------------

	private showRootMenu(event: MouseEvent): void {
		event.preventDefault();
		const root = this.app.vault.getRoot();
		const menu = new Menu();
		menu.addItem((entry) =>
			entry
				.setTitle("New note")
				.setIcon("file-plus")
				.onClick(() => void this.createNote(root)),
		);
		menu.addItem((entry) =>
			entry
				.setTitle("New folder")
				.setIcon("folder-plus")
				.onClick(() => void this.createFolder(root)),
		);
		this.addResetOrderItem(menu, root);
		menu.showAtMouseEvent(event);
	}

	/** Where a new item goes: the selected folder, the selected file's folder, or the root. */
	getTargetFolder(): TFolder {
		const selected = this.renderer?.getSelected();
		if (!selected) return this.app.vault.getRoot();
		if (selected.file instanceof TFolder) return selected.file;
		return selected.file.parent ?? this.app.vault.getRoot();
	}

	/**
	 * Clicking a row opens the note but leaves focus in the tree, the way a file
	 * tree normally behaves: the arrow keys keep working, and a shortcut bound
	 * to a TreeNav command still reaches the tree. `Enter` and the menu hand
	 * focus to the editor, because that is an explicit request to go and write.
	 */
	private async openFile(
		file: TFile,
		event: MouseEvent | null,
		focusEditor = false,
	): Promise<void> {
		const newLeaf = event ? Keymap.isModEvent(event) : false;
		try {
			await this.app.workspace.getLeaf(newLeaf).openFile(file, { active: focusEditor });
		} catch (error) {
			// Without this the failure is invisible: the previously open note
			// simply stays on screen.
			const reason = error instanceof Error ? error.message : String(error);
			new Notice(`TreeNav: could not open "${file.path}" — ${reason}`);
		}
	}

	private async openFolderNote(
		folder: TFolder,
		event: MouseEvent | null,
		focusEditor = false,
	): Promise<void> {
		const existing = this.plugin.folderNotes.getFolderNote(folder);
		const note = existing ?? (await this.plugin.folderNotes.createFolderNote(folder));
		if (!note) {
			new Notice(`TreeNav: "${folder.name}" has no folder note.`);
			return;
		}
		await this.openFile(note, event, focusEditor);
	}

	private async createNote(folder: TFolder): Promise<void> {
		if (!this.renderer) return;
		this.expandTarget(folder);

		const result = await this.plugin.fileOps.createNote(folder);
		if (!result.ok || !result.value) return;

		const item = await this.revealChanged(result.value.path);
		if (!item) return;

		this.renderer.select(item);
		this.startRename(item, (finalPath) => void this.openPath(finalPath));
	}

	private async createFolder(folder: TFolder): Promise<void> {
		if (!this.renderer) return;
		this.expandTarget(folder);

		const result = await this.plugin.fileOps.createFolder(folder);
		if (!result.ok || !result.value) return;

		const item = await this.revealChanged(result.value.path);
		if (!item) return;

		this.renderer.select(item);
		this.startRename(item);
	}

	/**
	 * Brings an item that just appeared or moved on screen. The vault event that
	 * rebuilds its folder may not have been delivered yet, so this retries once
	 * on the next frame before giving up.
	 */
	private async revealChanged(path: string): Promise<TreeItem | undefined> {
		const renderer = this.renderer;
		if (!renderer) return undefined;

		renderer.flush();
		const item = renderer.reveal(path);
		if (item) return item;

		renderer.scheduleRefresh(parentPath(path));
		await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
		renderer.flush();
		return renderer.reveal(path);
	}

	private expandTarget(folder: TFolder): void {
		if (folder.isRoot()) return;
		this.renderer?.reveal(folder.path)?.setExpanded(true);
	}

	private async openPath(path: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		// A note the user just created and named: put the cursor in it.
		if (file instanceof TFile) await this.openFile(file, null, true);
	}

	private startRename(item: TreeItem, onDone?: (finalPath: string) => void): void {
		const file = item.file;
		const originalPath = file.path;

		startInlineRename(item.titleEl, item.displayName, {
			onCommit: async (value) => {
				const name = this.toFileName(file, value);
				if (name) await this.plugin.fileOps.rename(file, name);

				// `file` is mutated in place by a successful rename; on failure it
				// still points at the untouched original.
				const finalPath = file.path;
				this.renderer?.flush();
				const refreshed = this.renderer?.reveal(finalPath);
				if (refreshed) this.renderer?.select(refreshed);
				onDone?.(finalPath);
			},
			onCancel: () => onDone?.(originalPath),
			selectRange: file instanceof TFile && file.extension !== "md" ? "stem" : "all",
		});
	}

	/** Re-attaches the extension that `displayName` hides for markdown notes. */
	private toFileName(file: TAbstractFile, value: string): string {
		const trimmed = value.trim();
		if (!trimmed) return "";
		if (file instanceof TFile && file.extension === "md" && !trimmed.includes(".")) {
			return `${trimmed}.md`;
		}
		return trimmed;
	}

	/**
	 * Deleting several always asks, whatever the setting says: the setting was
	 * agreed to for one file at a time, and a set is a bigger thing to undo.
	 */
	private confirmDeleteAll(files: TAbstractFile[]): void {
		const remove = async () => {
			for (const file of files) await this.plugin.fileOps.trash(file);
		};

		const folders = files.filter((file) => file instanceof TFolder).length;
		const detail = folders
			? ` Folders (${folders}) go with everything inside them.`
			: "";

		new ConfirmModal(
			this.app,
			`Delete ${files.length} items`,
			`${files.length} items will be moved to the trash.${detail}`,
			"Delete",
			() => void remove(),
		).open();
	}

	private confirmDelete(file: TAbstractFile): void {
		const remove = () => void this.plugin.fileOps.trash(file);

		if (!this.plugin.state.settings.confirmDelete) {
			remove();
			return;
		}

		const isFolder = file instanceof TFolder;
		new ConfirmModal(
			this.app,
			`Delete ${isFolder ? "folder" : "file"}`,
			isFolder
				? `"${file.name}" and everything inside it will be moved to the trash.`
				: `"${file.name}" will be moved to the trash.`,
			"Delete",
			remove,
		).open();
	}
}
