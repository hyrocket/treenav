import { App, Notice, Platform, TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";
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
 * How long to wait for a move Obsidian has queued rather than performed. Long:
 * a queued move waits for the metadata cache to settle, which took seconds in
 * a real vault while another plugin was indexing, and waiting blocks nothing.
 */
const ARRIVAL_TIMEOUT_MS = 60_000;

/**
 * `fileManager.renameFile`, resolving only once the file is really at `path`.
 *
 * Obsidian runs one link update at a time. Asked for a move while another one
 * is still updating links, it queues the new move behind it and returns at
 * once, with the file still where it was. Whatever runs next would read the
 * old location: a drop saving its order would save it under the path the file
 * is about to leave, and a flatten would trash the folder with the note still
 * inside.
 *
 * Callers that depend on the move check `file.path` afterwards: a queued move
 * that never lands gives up after a while rather than hanging.
 */
export async function renameAndWait(app: App, file: TAbstractFile, path: string): Promise<void> {
	await app.fileManager.renameFile(file, path);
	if (file.path === path) return;

	await new Promise<void>((resolve) => {
		const done = () => {
			app.vault.offref(ref);
			window.clearTimeout(timer);
			resolve();
		};
		const ref = app.vault.on("rename", (renamed) => {
			if (renamed === file && file.path === path) done();
		});
		const timer = window.setTimeout(done, ARRIVAL_TIMEOUT_MS);
	});
}

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

	/**
	 * A second copy beside the original, named the way a new note would be.
	 *
	 * The core file explorer offers this, but it fills its own menu before it
	 * fires the event other menus listen to, so the entry cannot be inherited —
	 * only rebuilt.
	 */
	async duplicate(file: TFile): Promise<OpResult<TFile>> {
		const parent = file.parent;
		if (!parent) return this.fail("Cannot copy a file outside the vault.");

		const extension = file.extension ? `.${file.extension}` : "";
		const name = this.uniqueName(parent, file.basename, extension);

		try {
			const copy = await this.app.vault.copy(file, normalizePath(joinPath(parent.path, name)));
			return { ok: true, value: copy };
		} catch (error) {
			return this.fail(`Could not copy "${file.name}": ${describe(error)}`);
		}
	}

	/**
	 * Copies files dropped in from outside the app into `folder`, the way the
	 * core file explorer does: each under its own name, numbered when taken.
	 * A file that already lives in the vault is not copied again.
	 */
	async importFiles(files: File[], folder: TFolder): Promise<TFile[]> {
		const created: TFile[] = [];
		for (const file of files) {
			if (this.vaultFileFor(file)) continue;

			const dot = file.name.lastIndexOf(".");
			const base = dot > 0 ? file.name.slice(0, dot) : file.name;
			const extension = dot > 0 ? file.name.slice(dot) : "";
			const name = this.uniqueName(folder, base, extension);
			try {
				const data = await file.arrayBuffer();
				created.push(await this.app.vault.createBinary(normalizePath(joinPath(folder.path, name)), data));
			} catch (error) {
				this.fail(`Could not import "${file.name}": ${describe(error)}`);
			}
		}
		return created;
	}

	/** The vault's own copy of a dropped file, when that is where it came from. */
	private vaultFileFor(file: File): TAbstractFile | null {
		// Only a desktop vault has a folder on disk to compare with.
		const adapter = this.app.vault.adapter as { getBasePath?: () => string } | undefined;
		const osPath = osPathOf(file);
		if (!osPath || !adapter?.getBasePath) return null;

		const base = adapter.getBasePath().replace(/\\/g, "/").replace(/\/$/, "");
		const path = osPath.replace(/\\/g, "/");
		// Windows and macOS disks do not care about case; the prefix test must not either.
		if (!path.toLowerCase().startsWith(base.toLowerCase() + "/")) return null;
		return this.app.vault.getAbstractFileByPath(normalizePath(path.slice(base.length + 1)));
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
			await renameAndWait(this.app, file, normalizePath(joinPath(parent.path, trimmed)));
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
			const path = normalizePath(joinPath(target.path, file.name));
			await renameAndWait(this.app, file, path);
			// Still queued behind another move: not there yet, so nothing may be
			// done on the assumption that it is.
			return { ok: file.path === path };
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
				await renameAndWait(this.app, note, normalizePath(joinPath(folderPath, note.name)));
			} else if (note.parent !== folder && !this.findConflict(folder, note.name)) {
				await renameAndWait(this.app, note, normalizePath(joinPath(folderPath, note.name)));
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

/**
 * Where a dropped file lives on disk, or `null` where the platform will not
 * say. Electron stopped putting it on `File.path` and asks for `webUtils`
 * instead; the old property still serves older builds. Mobile has neither.
 */
function osPathOf(file: File): string | null {
	if (!Platform.isDesktopApp) return null;
	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const { webUtils } = require("electron") as { webUtils?: { getPathForFile(file: File): string } };
		const path = webUtils?.getPathForFile(file);
		if (path) return path;
	} catch {
		// No electron to ask: fall through to the property.
	}
	return (file as File & { path?: string }).path || null;
}
