import { App, FuzzySuggestModal, TFolder } from "obsidian";

/**
 * Picks a destination folder. Complements drag & drop by making a move
 * reachable from the keyboard and the context menu.
 */
export class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
	private readonly folders: TFolder[];

	constructor(
		app: App,
		exclude: (folder: TFolder) => boolean,
		private readonly onChoose: (folder: TFolder) => void,
	) {
		super(app);
		this.setPlaceholder("Move to folder…");

		this.folders = [];
		const walk = (folder: TFolder) => {
			if (!exclude(folder)) this.folders.push(folder);
			for (const child of folder.children) {
				if (child instanceof TFolder) walk(child);
			}
		};
		walk(this.app.vault.getRoot());
	}

	getItems(): TFolder[] {
		return this.folders;
	}

	getItemText(folder: TFolder): string {
		return folder.isRoot() ? "/ (vault root)" : folder.path;
	}

	onChooseItem(folder: TFolder): void {
		this.onChoose(folder);
	}
}
