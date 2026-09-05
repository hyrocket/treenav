import { Plugin, TFile, TFolder, WorkspaceLeaf } from "obsidian";
import { DragDropService } from "./services/DragDropService";
import { FileOpsService } from "./services/FileOpsService";
import { FolderNoteService } from "./services/FolderNoteService";
import { StyleService } from "./services/StyleService";
import { TreeService } from "./services/TreeService";
import { TreeNavSettingTab } from "./settings/TreeNavSettingTab";
import { StateStore } from "./state/StateStore";
import { parentPath } from "./state/paths";
import { TREENAV_ICON, TREENAV_VIEW_TYPE } from "./types";
import { TreeNavView } from "./views/TreeNavView";

export default class TreeNavPlugin extends Plugin {
	state!: StateStore;
	folderNotes!: FolderNoteService;
	fileOps!: FileOpsService;
	treeService!: TreeService;
	dnd!: DragDropService;
	styles!: StyleService;

	async onload(): Promise<void> {
		this.state = new StateStore(this);
		await this.state.load();

		this.folderNotes = new FolderNoteService(this.app, this.state);
		this.fileOps = new FileOpsService(this.app);
		this.treeService = new TreeService(this.state, this.folderNotes);
		this.dnd = new DragDropService(this.app, this.fileOps, this.treeService, this.state);
		// A pure reorder changes no file, so no vault event announces it.
		this.dnd.onOrderChanged = (folderPath) => this.refreshFolder(folderPath);
		this.styles = new StyleService(this.state);

		this.registerView(TREENAV_VIEW_TYPE, (leaf) => new TreeNavView(leaf, this));
		this.addSettingTab(new TreeNavSettingTab(this.app, this));

		this.addRibbonIcon(TREENAV_ICON, "TreeNav", () => void this.activateView());
		this.addCommand({
			id: "open-treenav",
			name: "Open TreeNav",
			callback: () => void this.activateView(),
		});

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
