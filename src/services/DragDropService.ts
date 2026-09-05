import { App, TAbstractFile, TFile, TFolder } from "obsidian";
import { StateStore } from "../state/StateStore";
import { isSameOrDescendant } from "../state/paths";
import { FileOpsService } from "./FileOpsService";
import { TreeService } from "./TreeService";

const MIME = "application/x-treenav-path";
const DWELL_MS = 600;

/** Where a drop would put the dragged item, relative to the row under the pointer. */
export type DropMode = "into" | "nest" | "before" | "after";

/** The subset of a row the drag layer needs; `TreeItem` satisfies it. */
export interface DropTargetRow {
	readonly file: TAbstractFile;
	readonly isFolder: boolean;
	readonly rowEl: HTMLElement;
	readonly iconEl: HTMLElement;
	showDropIndicator(mode: DropMode | null): void;
	setExpanded(expanded: boolean): void;
}

/**
 * Drag & drop between rows.
 *
 * A row is split into zones so one gesture can express three different intents:
 * dropping on a note's icon nests the dragged item under it, dropping on the
 * name inserts above or below it, and the middle of a folder row drops into the
 * folder. `dataTransfer` cannot be read during `dragover`, so the dragged item
 * is kept here for the duration of the drag — that is what lets an invalid
 * target refuse the drop before the pointer is released.
 *
 * Every row stops the drag events from bubbling, so an invalid target never
 * silently hands the drop to an ancestor.
 */
export class DragDropService {
	/** Called with the folder whose listing changed, when no vault event will fire. */
	onOrderChanged: ((folderPath: string) => void) | null = null;

	private source: TAbstractFile | null = null;
	private indicated: DropTargetRow | null = null;

	constructor(
		private readonly app: App,
		private readonly fileOps: FileOpsService,
		private readonly tree: TreeService,
		private readonly state: StateStore,
	) {}

	makeDraggable(el: HTMLElement, getFile: () => TAbstractFile): void {
		el.draggable = true;

		el.addEventListener("dragstart", (event) => {
			const file = getFile();
			this.source = file;
			el.addClass("treenav-is-dragging");
			const transfer = event.dataTransfer;
			if (!transfer) return;
			transfer.effectAllowed = "move";
			transfer.setData(MIME, file.path);
			transfer.setData("text/plain", file.path);
		});

		el.addEventListener("dragend", () => {
			this.source = null;
			this.clearIndicator();
			el.removeClass("treenav-is-dragging");
		});
	}

	/** Wires a tree row up as a drop target with all three zones. */
	attachRow(row: DropTargetRow): void {
		let dwellTimer: number | null = null;

		const stopDwell = () => {
			if (dwellTimer === null) return;
			window.clearTimeout(dwellTimer);
			dwellTimer = null;
		};

		row.rowEl.addEventListener("dragover", (event) => {
			event.stopPropagation();

			const mode = this.resolveMode(event, row);
			if (!mode) {
				stopDwell();
				if (this.indicated === row) this.clearIndicator();
				return;
			}

			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
			this.setIndicator(row, mode);

			// Hovering a collapsed folder opens it, so nested targets are reachable.
			if (mode === "into" && row.isFolder && dwellTimer === null) {
				dwellTimer = window.setTimeout(() => {
					dwellTimer = null;
					row.setExpanded(true);
				}, DWELL_MS);
			} else if (mode !== "into") {
				stopDwell();
			}
		});

		row.rowEl.addEventListener("dragleave", (event) => {
			// Ignore the leave events fired when crossing into a child element.
			if (row.rowEl.contains(event.relatedTarget as Node | null)) return;
			stopDwell();
			if (this.indicated === row) this.clearIndicator();
		});

		row.rowEl.addEventListener("drop", (event) => {
			event.stopPropagation();
			stopDwell();
			this.clearIndicator();

			const mode = this.resolveMode(event, row);
			const source = this.resolveSource(event);
			if (!mode || !source) return;

			event.preventDefault();
			this.source = null;
			void this.execute(source, row.file, mode);
		});
	}

	/** The vault root accepts plain drops on empty space below the tree. */
	attachRootTarget(el: HTMLElement): void {
		const clear = () => el.removeClass("treenav-is-drop-target");

		el.addEventListener("dragover", (event) => {
			const root = this.app.vault.getRoot();
			if (!this.source || !this.canMoveInto(this.source, root)) {
				clear();
				return;
			}
			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
			el.addClass("treenav-is-drop-target");
		});

		el.addEventListener("dragleave", (event) => {
			if (el.contains(event.relatedTarget as Node | null)) return;
			clear();
		});

		el.addEventListener("drop", (event) => {
			clear();
			const source = this.resolveSource(event);
			const root = this.app.vault.getRoot();
			if (!source || !this.canMoveInto(source, root)) return;
			event.preventDefault();
			this.source = null;
			void this.fileOps.move(source, root);
		});
	}

	// --- Intent ------------------------------------------------------------

	/** Reads the pointer position and returns the intent, or `null` to refuse. */
	private resolveMode(event: DragEvent, row: DropTargetRow): DropMode | null {
		const source = this.source;
		if (!source || source === row.file) return null;

		const rect = row.rowEl.getBoundingClientRect();
		if (rect.height === 0) return null;
		const ratio = (event.clientY - rect.top) / rect.height;

		if (row.isFolder) {
			// The middle band drops into the folder; the edges reorder around it.
			if (ratio < 0.25) return this.checkReorder(source, row, "before");
			if (ratio > 0.75) return this.checkReorder(source, row, "after");
			return this.canMoveInto(source, row.file as TFolder) ? "into" : null;
		}

		const icon = row.iconEl.getBoundingClientRect();
		if (event.clientX >= icon.left - 4 && event.clientX <= icon.right + 4) {
			return this.canNest(source, row.file as TFile) ? "nest" : null;
		}

		return this.checkReorder(source, row, ratio < 0.5 ? "before" : "after");
	}

	private checkReorder(
		source: TAbstractFile,
		row: DropTargetRow,
		mode: "before" | "after",
	): DropMode | null {
		const parent = row.file.parent;
		if (!parent) return null;
		// Already in this folder: a pure reorder, no move needed.
		if (source.parent === parent) return mode;
		return this.fileOps.checkMove(source, parent) === null ? mode : null;
	}

	private canMoveInto(source: TAbstractFile, target: TFolder): boolean {
		if (source.parent === target) return false;
		return this.fileOps.checkMove(source, target) === null;
	}

	private canNest(source: TAbstractFile, note: TFile): boolean {
		if (note.extension !== "md") return false;
		// Nesting under a note that lives inside the dragged folder would move
		// the folder into itself.
		if (isSameOrDescendant(note.path, source.path)) return false;
		return true;
	}

	// --- Execution ---------------------------------------------------------

	private async execute(source: TAbstractFile, target: TAbstractFile, mode: DropMode): Promise<void> {
		if (mode === "into") {
			await this.fileOps.move(source, target as TFolder);
			return;
		}

		if (mode === "nest") {
			const note = target as TFile;
			const result = await this.fileOps.nestUnder(source, note);
			if (result.ok && result.value) {
				const { folder, created } = result.value;
				if (created) {
					// Only a folder TreeNav conjured out of a note may be undone later.
					this.state.markNested(folder.path);
					// The folder's row now stands exactly where the note's row was,
					// so it takes over the note's position and appearance.
					this.state.inherit(note.path, folder.path);
				}
				this.state.setExpanded(folder.path, true);
				this.onOrderChanged?.(folder.path);
			}
			return;
		}

		await this.reorder(source, target, mode);
	}

	/**
	 * Places `source` next to `target`, moving it into the target's folder first
	 * when it comes from elsewhere. The new order is taken from what the tree is
	 * currently showing, so the result matches what the user saw.
	 */
	private async reorder(
		source: TAbstractFile,
		target: TAbstractFile,
		mode: "before" | "after",
	): Promise<void> {
		const parent = target.parent;
		if (!parent) return;

		if (source.parent !== parent) {
			const moved = await this.fileOps.move(source, parent);
			if (!moved.ok) return;
		}

		const siblings = this.tree.getVisibleChildren(parent).filter((file) => file !== source);
		const index = siblings.indexOf(target);
		if (index === -1) return;

		siblings.splice(mode === "before" ? index : index + 1, 0, source);
		this.state.setOrder(siblings.map((file) => file.path));
		this.onOrderChanged?.(parent.path);
	}

	// --- Indicator ---------------------------------------------------------

	/**
	 * Only one row is ever marked. Rows stop drag events from bubbling, so a
	 * stale marker would otherwise be left behind when the pointer moves on.
	 */
	private setIndicator(row: DropTargetRow, mode: DropMode): void {
		if (this.indicated && this.indicated !== row) this.indicated.showDropIndicator(null);
		this.indicated = row;
		row.showDropIndicator(mode);
	}

	private clearIndicator(): void {
		this.indicated?.showDropIndicator(null);
		this.indicated = null;
	}

	private resolveSource(event: DragEvent): TAbstractFile | null {
		if (this.source) return this.source;
		const path = event.dataTransfer?.getData(MIME);
		if (!path) return null;
		return this.app.vault.getAbstractFileByPath(path);
	}
}
