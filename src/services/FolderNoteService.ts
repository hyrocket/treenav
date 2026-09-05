import { App, Notice, TFile, TFolder } from "obsidian";
import { FlattenDecision } from "../components/FlattenPromptModal";
import { StateStore } from "../state/StateStore";
import { FlattenMode } from "../types";
import { joinPath, parentPath } from "../state/paths";

/**
 * Folder notes use the "note of the same name inside the folder" convention:
 *
 *     Projects/Projects.md
 *
 * Nothing extra has to be stored: the relationship is derivable from the path,
 * survives moving the folder for free, and only needs maintenance when the
 * folder itself is renamed.
 */
export class FolderNoteService {
	/**
	 * Asks the user whether to flatten. Set by the plugin; without it the
	 * "ask" mode simply keeps the folder.
	 */
	askFlatten: ((folder: TFolder) => Promise<FlattenDecision>) | null = null;

	/** Folders currently being flattened, so a triggered event cannot re-enter. */
	private readonly flattening = new Set<string>();

	constructor(
		private readonly app: App,
		private readonly state: StateStore,
	) {}

	/** Expected folder note path, or `null` for the vault root. */
	getFolderNotePath(folder: TFolder): string | null {
		if (folder.isRoot()) return null;
		return joinPath(folder.path, `${folder.name}.md`);
	}

	getFolderNote(folder: TFolder): TFile | null {
		const path = this.getFolderNotePath(folder);
		if (!path) return null;
		const file = this.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile ? file : null;
	}

	isFolderNote(file: TFile): boolean {
		if (file.extension !== "md") return false;
		const parent = file.parent;
		if (!parent || parent.isRoot()) return false;
		return parent.name === file.basename;
	}

	async createFolderNote(folder: TFolder): Promise<TFile | null> {
		const path = this.getFolderNotePath(folder);
		if (!path) return null;

		const existing = this.getFolderNote(folder);
		if (existing) return existing;

		try {
			return await this.app.vault.create(path, `# ${folder.name}\n`);
		} catch (error) {
			new Notice(`TreeNav: could not create folder note — ${describe(error)}`);
			return null;
		}
	}

	/**
	 * Keeps `Folder/Folder.md` matching after the folder is renamed. Moves are
	 * ignored on purpose: the note travels with the folder and its name is
	 * still correct.
	 */
	syncAfterFolderRename(folder: TFolder, oldPath: string): void {
		const oldName = oldPath.slice(oldPath.lastIndexOf("/") + 1);
		if (oldName === folder.name) return;

		// The note is looked up through the folder's own children rather than by
		// path: when this event fires, the child paths have not necessarily been
		// rewritten yet, so a path lookup finds nothing.
		const note = folder.children.find(
			(child): child is TFile =>
				child instanceof TFile && child.extension === "md" && child.basename === oldName,
		);
		if (!note) return;

		const targetName = `${folder.name}.md`;
		const taken = folder.children.some(
			(child) => child !== note && child.name.toLowerCase() === targetName.toLowerCase(),
		);
		if (taken) {
			new Notice(`TreeNav: "${targetName}" already exists, folder note kept as "${oldName}.md".`);
			return;
		}

		// Deferred to a fresh task so Obsidian can finish the rename that
		// triggered this before a second one starts.
		window.setTimeout(() => void this.renameNote(note, folder), 0);
	}

	/**
	 * The other direction: renaming the folder note renames its folder, so the
	 * pair never drifts apart no matter which half the user edits. Moving the
	 * note out of the folder is not a rename and is left alone.
	 */
	syncAfterFolderNoteRename(file: TFile, oldPath: string): void {
		if (file.extension !== "md") return;

		const folder = file.parent;
		if (!folder || folder.isRoot()) return;
		if (parentPath(oldPath) !== folder.path) return;

		const oldName = oldPath.slice(oldPath.lastIndexOf("/") + 1);
		const oldBaseName = oldName.slice(0, oldName.lastIndexOf("."));
		// Only act when the note *was* this folder's note and no longer matches.
		if (oldBaseName !== folder.name || file.basename === folder.name) return;

		const parent = folder.parent;
		if (!parent) return;

		const taken = parent.children.some(
			(child) => child !== folder && child.name.toLowerCase() === file.basename.toLowerCase(),
		);
		if (taken) {
			new Notice(`TreeNav: "${file.basename}" already exists, the folder was not renamed.`);
			return;
		}

		window.setTimeout(() => void this.renameFolder(folder, file.basename), 0);
	}

	/**
	 * The inverse of nesting: once the folder TreeNav created is down to its own
	 * folder note, the note moves back out and the empty folder is trashed, so
	 * the item looks exactly as it did before anything was dropped on it.
	 *
	 * Deliberately narrow. It only ever touches a folder TreeNav created by
	 * nesting, only when nothing but the folder note is left — attachments and
	 * files TreeNav hides still count — and it puts the folder in the trash
	 * rather than deleting it, because there is no undo for file operations.
	 */
	flattenIfEmptied(folderPath: string): void {
		const mode = this.state.settings.flattenNestedFolders;
		if (mode === "never") return;
		if (this.flattening.has(folderPath)) return;
		if (!this.flattenTarget(folderPath)) return;

		this.flattening.add(folderPath);
		window.setTimeout(() => void this.resolveFlatten(folderPath, mode), 0);
	}

	/**
	 * Everything the flatten needs, or `null` when it must not happen. Called
	 * again after the prompt, because the vault can move on while a modal is
	 * open.
	 */
	private flattenTarget(
		folderPath: string,
	): { folder: TFolder; note: TFile; targetPath: string } | null {
		if (!this.state.isNested(folderPath)) return null;

		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		if (!(folder instanceof TFolder) || folder.isRoot()) return null;

		const note = this.getFolderNote(folder);
		if (!note) return null;
		// Every remaining child counts, including ones the tree does not show.
		if (folder.children.length !== 1 || folder.children[0] !== note) return null;

		const parent = folder.parent;
		if (!parent) return null;

		const targetPath = joinPath(parent.path, note.name);
		if (this.app.vault.getAbstractFileByPath(targetPath)) return null;

		return { folder, note, targetPath };
	}

	private async resolveFlatten(folderPath: string, mode: FlattenMode): Promise<void> {
		try {
			if (mode === "ask") {
				const pending = this.flattenTarget(folderPath);
				if (!pending) return;
				const decision = this.askFlatten ? await this.askFlatten(pending.folder) : "keep";
				if (decision === "keep") return;
			}

			const target = this.flattenTarget(folderPath);
			if (!target) return;
			await this.flatten(target.folder, target.note, target.targetPath, folderPath);
		} finally {
			this.flattening.delete(folderPath);
		}
	}

	private async flatten(
		folder: TFolder,
		note: TFile,
		targetPath: string,
		trackedPath: string,
	): Promise<void> {
		try {
			await this.app.fileManager.renameFile(note, targetPath);
			// The note's row takes the folder row's place, so it takes over what
			// the user set on the folder. Must happen before the folder is
			// trashed, which discards the folder's own entries.
			this.state.inherit(folder.path, targetPath);
			await this.app.fileManager.trashFile(folder);
			this.state.unmarkNested(trackedPath);
		} catch (error) {
			new Notice(`TreeNav: could not restore "${note.basename}" — ${describe(error)}`);
		}
	}

	private async renameFolder(folder: TFolder, name: string): Promise<void> {
		try {
			await this.app.fileManager.renameFile(folder, joinPath(parentPath(folder.path), name));
		} catch (error) {
			new Notice(`TreeNav: could not rename folder — ${describe(error)}`);
		}
	}

	private async renameNote(note: TFile, folder: TFolder): Promise<void> {
		try {
			await this.app.fileManager.renameFile(note, joinPath(folder.path, `${folder.name}.md`));
		} catch (error) {
			new Notice(`TreeNav: could not rename folder note — ${describe(error)}`);
		}
	}
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
