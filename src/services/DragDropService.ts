import { App, TAbstractFile, TFile, TFolder } from "obsidian";
import { isSameOrDescendant } from "../state/paths";
import { FileOpsService } from "./FileOpsService";
import { OutlineService } from "./OutlineService";

const MIME = "application/x-treenav-path";
const DWELL_MS = 600;
/** A drag carries several paths; no path can contain a newline. */
const SEPARATOR = "\n";

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
 * folder. `dataTransfer` cannot be read during `dragover`, so the dragged items
 * are kept here for the duration of the drag — that is what lets an invalid
 * target refuse the drop before the pointer is released.
 *
 * A drag carries a set, not one item: taking hold of a row that is part of the
 * selection takes the whole selection with it. A target that suits some of them
 * and not others is still offered, and the ones it does not suit stay where they
 * are — refusing the whole drop over one item would be the worse answer.
 *
 * Every row stops the drag events from bubbling, so an invalid target never
 * silently hands the drop to an ancestor.
 */
export class DragDropService {
	/**
	 * Everything a drag starting on this row should carry. Set by the view,
	 * which owns the selection; without it a drag carries the row alone.
	 */
	resolveDragSet: ((file: TAbstractFile) => TAbstractFile[]) | null = null;

	private sources: TAbstractFile[] = [];
	private indicated: DropTargetRow | null = null;

	constructor(
		private readonly app: App,
		private readonly fileOps: FileOpsService,
		private readonly outline: OutlineService,
	) {}

	makeDraggable(el: HTMLElement, getFile: () => TAbstractFile): void {
		el.draggable = true;

		el.addEventListener("dragstart", (event) => {
			const file = getFile();
			const set = this.resolveDragSet?.(file) ?? [];
			this.sources = set.length > 0 ? set : [file];
			this.markDragging(true);

			const transfer = event.dataTransfer;
			if (!transfer) return;
			const paths = this.sources.map((source) => source.path).join(SEPARATOR);
			transfer.effectAllowed = "move";
			transfer.setData(MIME, paths);
			transfer.setData("text/plain", paths);
		});

		el.addEventListener("dragend", () => {
			this.markDragging(false);
			this.sources = [];
			this.clearIndicator();
		});
	}

	/** Marks every row being dragged, not just the one under the pointer. */
	private markDragging(on: boolean): void {
		for (const source of this.sources) {
			this.rowFor?.(source)?.toggleClass("treenav-is-dragging", on);
		}
	}

	/** Finds the row element for a file. Set by the view, which owns the DOM. */
	rowFor: ((file: TAbstractFile) => HTMLElement | null) | null = null;

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
			const sources = this.resolveSources(event);
			if (!mode || sources.length === 0) return;

			event.preventDefault();
			this.markDragging(false);
			this.sources = [];
			void this.execute(sources, row.file, mode);
		});
	}

	/** The vault root accepts plain drops on empty space below the tree. */
	attachRootTarget(el: HTMLElement): void {
		const clear = () => el.removeClass("treenav-is-drop-target");

		el.addEventListener("dragover", (event) => {
			const root = this.app.vault.getRoot();
			if (!this.sources.some((source) => this.canMoveInto(source, root))) {
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
			const root = this.app.vault.getRoot();
			const sources = this.resolveSources(event);
			if (!sources.some((source) => this.canMoveInto(source, root))) return;
			event.preventDefault();
			this.markDragging(false);
			this.sources = [];
			void this.moveAll(sources, root);
		});
	}

	// --- Intent ------------------------------------------------------------

	/**
	 * Reads the pointer position and returns the intent, or `null` to refuse.
	 * An intent stands if it suits any one of the dragged items.
	 */
	private resolveMode(event: DragEvent, row: DropTargetRow): DropMode | null {
		const sources = this.sources;
		// Dropping a set onto one of its own members means nothing.
		if (sources.length === 0 || sources.includes(row.file)) return null;

		const rect = row.rowEl.getBoundingClientRect();
		if (rect.height === 0) return null;
		const ratio = (event.clientY - rect.top) / rect.height;
		const any = (test: (source: TAbstractFile) => boolean) => sources.some(test);

		if (row.isFolder) {
			// The middle band drops into the folder; the edges reorder around it.
			if (ratio < 0.25) return this.checkReorder(row, "before");
			if (ratio > 0.75) return this.checkReorder(row, "after");
			return any((source) => this.canMoveInto(source, row.file as TFolder)) ? "into" : null;
		}

		const icon = row.iconEl.getBoundingClientRect();
		if (event.clientX >= icon.left - 4 && event.clientX <= icon.right + 4) {
			return any((source) => this.canNest(source, row.file as TFile)) ? "nest" : null;
		}

		return this.checkReorder(row, ratio < 0.5 ? "before" : "after");
	}

	private checkReorder(row: DropTargetRow, mode: "before" | "after"): DropMode | null {
		const parent = row.file.parent;
		if (!parent) return null;
		const canReorder = (source: TAbstractFile) =>
			// Already in this folder: a pure reorder, no move needed.
			source.parent === parent || this.fileOps.checkMove(source, parent) === null;
		return this.sources.some(canReorder) ? mode : null;
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

	/** A drop means the same thing as the matching keyboard move. */
	private async execute(
		sources: TAbstractFile[],
		target: TAbstractFile,
		mode: DropMode,
	): Promise<void> {
		switch (mode) {
			case "into":
				await this.moveAll(sources, target as TFolder);
				return;
			case "nest":
				// The first one turns the note into a folder; the rest join it.
				for (const source of sources) {
					if (this.canNest(source, target as TFile)) {
						await this.outline.nestUnder(source, target as TFile);
					}
				}
				return;
			default:
				await this.outline.placeAllNextTo(sources, target, mode);
		}
	}

	/** One at a time: two moves at once can race for the same name. */
	private async moveAll(sources: TAbstractFile[], target: TFolder): Promise<void> {
		for (const source of sources) {
			if (this.canMoveInto(source, target)) await this.fileOps.move(source, target);
		}
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

	/**
	 * The dragged items. The live list is authoritative; the transfer data is
	 * the fallback for a drag this instance did not see start.
	 */
	private resolveSources(event: DragEvent): TAbstractFile[] {
		if (this.sources.length > 0) return this.sources;

		const data = event.dataTransfer?.getData(MIME);
		if (!data) return [];
		return data
			.split(SEPARATOR)
			.map((path) => this.app.vault.getAbstractFileByPath(path))
			.filter((file): file is TAbstractFile => file !== null);
	}
}
