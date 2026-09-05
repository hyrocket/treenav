import { App, Notice, TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";
import { isSameOrDescendant, joinPath } from "../state/paths";

/** A nest either reused an existing folder or created one that can be undone. */
export interface NestResult {
	folder: TFolder;
	created: boolean;
}

export interface OpResult<T> {
	ok: boolean;
	value?: T;
	error?: string;
}

const INVALID_NAME = /[\/:*?"<>|]/;

/**
 * Every mutation of the vault goes through here, and always through the
 * official Vault / FileManager API: `fileManager.renameFile` so links and
 * metadata follow the move, `fileManager.trashFile` so the user's trash
 * preference is respected. Nothing touches the filesystem directly.
 */
export class FileOpsService {
	constructor(private readonly app: App) {}

	/** Case-insensitive sibling lookup: Windows and macOS collide on case. */
	private findConflict(parent: TFolder, name: string, ignore?: TAbstractFile): TAbstractFile | null {
		const lower = name.toLowerCase();
		for (const child of parent.children) {
			if (child === ignore) continue;
			if (child.name.toLowerCase() === lower) return child;
		}
		return null;
	}

	private uniqueName(parent: TFolder, base: string, extension: string): string {
		let name = `${base}${extension}`;
		let counter = 1;
		while (this.findConflict(parent, name)) {
			name = `${base} ${counter}${extension}`;
			counter += 1;
		}
		return name;
	}

	async createNote(parent: TFolder, baseName = "Untitled"): Promise<OpResult<TFile>> {
		const name = this.uniqueName(parent, baseName, ".md");
		try {
			const file = await this.app.vault.create(normalizePath(joinPath(parent.path, name)), "");
			return { ok: true, value: file };
		} catch (error) {
			return this.fail(`Could not create note: ${describe(error)}`);
		}
	}

	async createFolder(parent: TFolder, baseName = "New folder"): Promise<OpResult<TFolder>> {
		const name = this.uniqueName(parent, baseName, "");
		try {
			const folder = await this.app.vault.createFolder(normalizePath(joinPath(parent.path, name)));
			return { ok: true, value: folder };
		} catch (error) {
			return this.fail(`Could not create folder: ${describe(error)}`);
		}
	}

	/** Renames within the current parent. `newName` includes the extension. */
	async rename(file: TAbstractFile, newName: string): Promise<OpResult<void>> {
		const trimmed = newName.trim();
		if (!trimmed) return this.fail("Name cannot be empty.");
		if (INVALID_NAME.test(trimmed)) return this.fail(`"${trimmed}" contains characters that are not allowed in a name.`);
		if (trimmed === file.name) return { ok: true };

		const parent = file.parent;
		if (!parent) return this.fail("Cannot rename the vault root.");

		if (this.findConflict(parent, trimmed, file)) {
			return this.fail(`"${trimmed}" already exists in this folder.`);
		}

		try {
			await this.app.fileManager.renameFile(file, normalizePath(joinPath(parent.path, trimmed)));
			return { ok: true };
		} catch (error) {
			// The original file is untouched when renameFile throws.
			return this.fail(`Could not rename: ${describe(error)}`);
		}
	}

	/** Validates a move without performing it. Returns an error message or `null`. */
	checkMove(file: TAbstractFile, target: TFolder): string | null {
		if (file === target) return "A folder cannot be moved into itself.";
		if (file.parent === target) return null; // no-op, silently ignored
		if (file instanceof TFolder && isSameOrDescendant(target.path, file.path)) {
			return "A folder cannot be moved into one of its own subfolders.";
		}
		if (this.findConflict(target, file.name, file)) {
			return `"${file.name}" already exists in "${target.isRoot() ? "the vault root" : target.name}".`;
		}
		return null;
	}

	async move(file: TAbstractFile, target: TFolder): Promise<OpResult<void>> {
		if (file.parent === target) return { ok: true };

		const problem = this.checkMove(file, target);
		if (problem) return this.fail(problem);

		try {
			await this.app.fileManager.renameFile(file, normalizePath(joinPath(target.path, file.name)));
			return { ok: true };
		} catch (error) {
			return this.fail(`Could not move: ${describe(error)}`);
		}
	}

	/**
	 * Makes `note` the parent of `source` by turning it into a folder note:
	 * `Ideas/A.md` becomes `Ideas/A/A.md` and `source` moves in beside it.
	 * Clicking A still opens the same note — it just has children now.
	 *
	 * Returns the folder that now holds both, so the caller can expand it.
	 */
	async nestUnder(source: TAbstractFile, note: TFile): Promise<OpResult<NestResult>> {
		if (source === note) return { ok: false };
		if (note.extension !== "md") return this.fail("Only notes can hold other items.");

		const parent = note.parent;
		if (!parent) return this.fail("Cannot nest under a file outside the vault.");

		const folderPath = normalizePath(joinPath(parent.path, note.basename));
		const existing = this.app.vault.getAbstractFileByPath(folderPath);

		if (existing && !(existing instanceof TFolder)) {
			return this.fail(`"${note.basename}" already exists here and is not a folder.`);
		}

		let folder = existing as TFolder | null;
		const created = !folder;

		try {
			if (!folder) {
				folder = await this.app.vault.createFolder(folderPath);
				// The note becomes the folder note of the folder just created.
				await this.app.fileManager.renameFile(note, normalizePath(joinPath(folderPath, note.name)));
			} else if (note.parent !== folder && !this.findConflict(folder, note.name)) {
				await this.app.fileManager.renameFile(note, normalizePath(joinPath(folderPath, note.name)));
			}
		} catch (error) {
			return this.fail(`Could not nest under "${note.basename}": ${describe(error)}`);
		}

		const moved = await this.move(source, folder);
		return moved.ok ? { ok: true, value: { folder, created } } : { ok: false, error: moved.error };
	}

	async trash(file: TAbstractFile): Promise<OpResult<void>> {
		try {
			await this.app.fileManager.trashFile(file);
			return { ok: true };
		} catch (error) {
			return this.fail(`Could not delete: ${describe(error)}`);
		}
	}

	private fail(message: string): OpResult<never> {
		new Notice(`TreeNav: ${message}`);
		return { ok: false, error: message };
	}
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
