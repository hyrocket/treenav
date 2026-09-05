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
import { FolderSuggestModal } from "../components/FolderSuggestModal";
import { IconPickerModal } from "../components/IconPickerModal";
import { startInlineRename } from "../components/InlineRename";
import { ColorModal, FontModal } from "../components/StyleModals";
import { TreeItem } from "../components/TreeItem";
import { TreeRenderer, TreeRendererHost } from "../components/TreeRenderer";
import { parentPath } from "../state/paths";
import { TREENAV_ICON, TREENAV_VIEW_TYPE, TreeNavStyle } from "../types";
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
		this.renderer?.render();
		this.renderer?.setActiveFile(this.app.workspace.getActiveFile());
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
			void this.openFolderNote(item.file, null);
			return;
		}
		void this.openFile(item.file as TFile, null);
	}

	renameItem(item: TreeItem): void {
		this.startRename(item);
	}

	deleteItem(item: TreeItem): void {
		this.confirmDelete(item.file);
	}

	createNoteIn(folder: TFolder): void {
		void this.createNote(folder);
	}

	createFolderIn(folder: TFolder): void {
		void this.createFolder(folder);
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

	onItemContextMenu(item: TreeItem, event: MouseEvent): void {
		event.preventDefault();

		const file = item.file;
		const folder = file instanceof TFolder ? file : file.parent ?? this.app.vault.getRoot();
		const menu = new Menu();

		if (file instanceof TFile) {
			menu.addItem((entry) =>
				entry
					.setTitle("Open")
					.setIcon("file")
					.onClick(() => void this.openFile(file, null)),
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
					.onClick(() => void this.openFolderNote(file as TFolder, null)),
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

	// --- Appearance --------------------------------------------------------

	private addStyleItems(menu: Menu, item: TreeItem): void {
		const path = item.path;
		const styles = this.plugin.styles;

		menu.addItem((entry) =>
			entry
				.setTitle("Set icon")
				.setIcon("image")
				.onClick(() => {
					new IconPickerModal(this.app, styles.get(path)?.icon, (icon) =>
						this.applyStyle(path, { icon }),
					).open();
				}),
		);

		menu.addItem((entry) =>
			entry
				.setTitle("Set color")
				.setIcon("palette")
				.onClick(() => {
					new ColorModal(this.app, item.displayName, styles.get(path)?.color, (color) =>
						this.applyStyle(path, { color }),
					).open();
				}),
		);

		menu.addItem((entry) =>
			entry
				.setTitle("Set font")
				.setIcon("type")
				.onClick(() => {
					new FontModal(this.app, item.displayName, styles.get(path), (font) =>
						this.applyStyle(path, font),
					).open();
				}),
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

	private async openFile(file: TFile, event: MouseEvent | null): Promise<void> {
		const newLeaf = event ? Keymap.isModEvent(event) : false;
		try {
			await this.app.workspace.getLeaf(newLeaf).openFile(file);
		} catch (error) {
			// Without this the failure is invisible: the previously open note
			// simply stays on screen.
			const reason = error instanceof Error ? error.message : String(error);
			new Notice(`TreeNav: could not open "${file.path}" — ${reason}`);
		}
	}

	private async openFolderNote(folder: TFolder, event: MouseEvent | null): Promise<void> {
		const existing = this.plugin.folderNotes.getFolderNote(folder);
		const note = existing ?? (await this.plugin.folderNotes.createFolderNote(folder));
		if (!note) {
			new Notice(`TreeNav: "${folder.name}" has no folder note.`);
			return;
		}
		await this.openFile(note, event);
	}

	private async createNote(folder: TFolder): Promise<void> {
		if (!this.renderer) return;
		this.expandTarget(folder);

		const result = await this.plugin.fileOps.createNote(folder);
		if (!result.ok || !result.value) return;

		const item = await this.revealCreated(result.value.path);
		if (!item) return;

		this.renderer.select(item);
		this.startRename(item, (finalPath) => void this.openPath(finalPath));
	}

	private async createFolder(folder: TFolder): Promise<void> {
		if (!this.renderer) return;
		this.expandTarget(folder);

		const result = await this.plugin.fileOps.createFolder(folder);
		if (!result.ok || !result.value) return;

		const item = await this.revealCreated(result.value.path);
		if (!item) return;

		this.renderer.select(item);
		this.startRename(item);
	}

	/**
	 * Brings a just-created item on screen. The vault event that would rebuild
	 * the parent may not have been delivered yet, so this retries once on the
	 * next frame before giving up.
	 */
	private async revealCreated(path: string): Promise<TreeItem | undefined> {
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
		if (file instanceof TFile) await this.openFile(file, null);
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
