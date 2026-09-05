import { Plugin, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { FlattenDecision, FlattenPromptModal } from "./components/FlattenPromptModal";
import { DragDropService } from "./services/DragDropService";
import { FileOpsService } from "./services/FileOpsService";
import { FolderNoteService } from "./services/FolderNoteService";
import { OutlineService } from "./services/OutlineService";
import { StyleService } from "./services/StyleService";
import { TreeService } from "./services/TreeService";
import { TreeNavSettingTab } from "./settings/TreeNavSettingTab";
import { StateStore } from "./state/StateStore";
import { parentPath } from "./state/paths";
import { TREENAV_ICON, TREENAV_VIEW_TYPE } from "./types";
import { TreeItem } from "./components/TreeItem";
import { TreeNavView } from "./views/TreeNavView";

export default class TreeNavPlugin extends Plugin {
	state!: StateStore;
	folderNotes!: FolderNoteService;
	fileOps!: FileOpsService;
	treeService!: TreeService;
	dnd!: DragDropService;
	outline!: OutlineService;
	styles!: StyleService;

	async onload(): Promise<void> {
		this.state = new StateStore(this);
		await this.state.load();

		this.folderNotes = new FolderNoteService(this.app, this.state);
		this.folderNotes.askFlatten = (folder) => this.promptFlatten(folder);
		this.fileOps = new FileOpsService(this.app);
		this.treeService = new TreeService(this.state, this.folderNotes);
		this.outline = new OutlineService(this.fileOps, this.treeService, this.state);
		// A pure reorder changes no file, so no vault event announces it.
		this.outline.onChanged = (folderPath) => this.refreshFolder(folderPath);
		this.dnd = new DragDropService(this.app, this.fileOps, this.outline);
		this.styles = new StyleService(this.state);

		this.registerView(TREENAV_VIEW_TYPE, (leaf) => new TreeNavView(leaf, this));
		this.addSettingTab(new TreeNavSettingTab(this.app, this));

		this.addRibbonIcon(TREENAV_ICON, "TreeNav", () => void this.activateView());
		this.addCommand({
			id: "open-treenav",
			name: "Open TreeNav",
			callback: () => void this.activateView(),
		});
		this.registerTreeCommands();

		this.registerVaultEvents();
	}

	onunload(): void {
		// Flushes whatever the debounced writer still had queued.
		void this.state.save();
	}

	/** Reveals the TreeNav view, opening it in the left sidebar if needed. */
	async activateView(): Promise<void> {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(TREENAV_VIEW_TYPE)[0] ?? null;
		if (!leaf) {
			leaf = workspace.getLeftLeaf(false);
			if (!leaf) return;
			await leaf.setViewState({ type: TREENAV_VIEW_TYPE, active: true });
		}

		await workspace.revealLeaf(leaf);
	}

	/**
	 * Asks whether an emptied nested folder should fold back into a note, and
	 * records the answer when the user does not want to be asked again.
	 */
	private promptFlatten(folder: TFolder): Promise<FlattenDecision> {
		return new Promise((resolve) => {
			new FlattenPromptModal(this.app, folder.name, (decision, remember) => {
				if (remember) {
					this.state.settings.flattenNestedFolders = decision === "flatten" ? "always" : "never";
					void this.state.save();
				}
				resolve(decision);
			}).open();
		});
	}

	/**
	 * Commands that act on the tree.
	 *
	 * None ship a default hotkey. They exist so the keys can be bound in
	 * Obsidian's own hotkey settings, which handles conflicts and rebinding far
	 * better than a bespoke settings page would. The built-in keys the view
	 * already handles (arrows, F2, Delete, Ctrl+N) stay in the view, so nothing
	 * fires twice.
	 *
	 * Every one is gated on TreeNav holding keyboard focus, so a single-letter
	 * binding cannot go off while the user is typing in a note.
	 */
	private registerTreeCommands(): void {
		const onSelection = (action: (view: TreeNavView, item: TreeItem) => void) => {
			return (view: TreeNavView) => view.withSelected((item) => action(view, item));
		};

		const commands: { id: string; name: string; run: (view: TreeNavView) => void }[] = [
			{ id: "new-note", name: "New note", run: (view) => view.newNote() },
			{ id: "new-folder", name: "New folder", run: (view) => view.newFolder() },
			{
				id: "rename",
				name: "Rename item",
				run: onSelection((view, item) => view.renameItem(item)),
			},
			{
				id: "delete",
				name: "Delete item",
				run: onSelection((view, item) => view.deleteItem(item)),
			},
			{ id: "set-icon", name: "Set icon", run: onSelection((view, item) => view.promptIcon(item)) },
			{
				id: "set-appearance",
				name: "Set appearance",
				run: onSelection((view, item) => view.promptAppearance(item)),
			},
			{
				id: "move-up",
				name: "Move item up",
				run: onSelection((view, item) => view.moveStep(item, -1)),
			},
			{
				id: "move-down",
				name: "Move item down",
				run: onSelection((view, item) => view.moveStep(item, 1)),
			},
			{
				id: "move-to-top",
				name: "Move item to top",
				run: onSelection((view, item) => view.moveToEdge(item, "top")),
			},
			{
				id: "move-to-bottom",
				name: "Move item to bottom",
				run: onSelection((view, item) => view.moveToEdge(item, "bottom")),
			},
			{
				id: "indent",
				name: "Indent item",
				run: onSelection((view, item) => view.indentItem(item)),
			},
			{
				id: "outdent",
				name: "Outdent item",
				run: onSelection((view, item) => view.outdentItem(item)),
			},
		];

		for (const command of commands) {
			this.addCommand({
				id: command.id,
				name: command.name,
				checkCallback: (checking) => {
					const view = this.focusedView();
					if (!view) return false;
					if (!checking) command.run(view);
					return true;
				},
			});
		}
	}

	/** The TreeNav view holding keyboard focus, if any. */
	private focusedView(): TreeNavView | null {
		for (const leaf of this.app.workspace.getLeavesOfType(TREENAV_VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof TreeNavView && view.hasFocus()) return view;
		}
		return null;
	}

	/** Forces a full re-render of every open TreeNav view. */
	refreshViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(TREENAV_VIEW_TYPE)) {
			if (leaf.view instanceof TreeNavView) leaf.view.rebuild();
		}
	}

	/** Re-renders one folder's listing in every open view. */
	refreshFolder(folderPath: string): void {
		for (const leaf of this.app.workspace.getLeavesOfType(TREENAV_VIEW_TYPE)) {
			if (leaf.view instanceof TreeNavView) leaf.view.refreshFolder(folderPath);
		}
	}

	/** Repaints stored styles in every open view without rebuilding the tree. */
	refreshStyles(path?: string): void {
		for (const leaf of this.app.workspace.getLeavesOfType(TREENAV_VIEW_TYPE)) {
			if (leaf.view instanceof TreeNavView) leaf.view.refreshStyles(path);
		}
	}

	/**
	 * Vault-wide bookkeeping that has to happen whether or not a view is open:
	 * migrating path-keyed state and keeping folder notes named after their
	 * folder.
	 */
	private registerVaultEvents(): void {
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				this.state.handleRename(oldPath, file.path);
				if (file instanceof TFolder) {
					this.folderNotes.syncAfterFolderRename(file, oldPath);
				} else if (file instanceof TFile) {
					this.folderNotes.syncAfterFolderNoteRename(file, oldPath);
				}
				// The item may have been the last thing keeping a nested folder alive.
				this.folderNotes.flattenIfEmptied(parentPath(oldPath));
			}),
		);

		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				this.state.handleDelete(file.path);
				this.folderNotes.flattenIfEmptied(parentPath(file.path));
			}),
		);
	}
}
