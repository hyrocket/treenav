import { App, TAbstractFile, TFile, TFolder } from "obsidian";
import { isSameOrDescendant } from "../state/paths";
import { FileOpsService } from "./FileOpsService";
import { OutlineService } from "./OutlineService";

/** How long a finger has to rest on a row before it picks it up. */
const LONG_PRESS_MS = 400;
/** How far the mouse travels before a press becomes a drag. */
const MOUSE_SLOP = 4;
/** How far a finger may stray before the press is read as a scroll instead. */
const TOUCH_SLOP = 10;
/** How long the pointer rests on a collapsed folder before it opens. */
const DWELL_MS = 600;
/** How close to the edge of the tree the pointer scrolls it, and how fast. */
const EDGE_PX = 40;
const EDGE_SPEED = 8;

/** Where a drop would put the dragged items, relative to the row under the pointer. */
export type DropMode = "into" | "nest" | "before" | "after";

/** The subset of a row the drag layer needs; `TreeItem` satisfies it. */
export interface DropTargetRow {
	readonly file: TAbstractFile;
	readonly isFolder: boolean;
	readonly rowEl: HTMLElement;
	readonly iconEl: HTMLElement;
	readonly displayName: string;
	showDropIndicator(mode: DropMode | null): void;
	setExpanded(expanded: boolean): void;
	showContextMenu(event: MouseEvent): void;
}

/** A press that has not yet decided whether it is a click, a scroll or a drag. */
interface Press {
	row: DropTargetRow;
	pointerId: number;
	touch: boolean;
	x: number;
	y: number;
	/** Set once the long press has fired: releasing now opens the menu. */
	armed: boolean;
	timer: number | null;
}

/**
 * Drag & drop between rows, driven by pointer events.
 *
 * Pointer events rather than HTML5 drag & drop: the HTML5 kind is a mouse-only
 * protocol — a touch never produces `dragstart`, so on a phone the tree could
 * not be rearranged at all. One pointer implementation covers mouse, pen and
 * touch, and it also lets the drag carry a proper preview of what is moving.
 *
 * The gestures differ only in how a drag begins. A mouse starts one by moving a
 * few pixels; a finger has to rest on the row first, because a finger that
 * moves straight away is scrolling. Once the long press has fired, releasing
 * without moving opens the row's menu — the same "press and hold, then move or
 * let go" the platforms themselves use.
 *
 * A row is split into zones so one gesture can express three different intents:
 * pressing on a note's icon nests the dragged items under it, the name inserts
 * above or below it, and the middle of a folder row drops into the folder.
 *
 * A drag carries a set, not one item: taking hold of a row that is part of the
 * selection takes the whole selection with it. A target that suits some of them
 * and not others is still offered, and the ones it does not suit stay where they
 * are — refusing the whole drop over one item would be the worse answer.
 */
export class DragDropService {
	/**
	 * Everything a drag starting on this row should carry. Set by the view,
	 * which owns the selection; without it a drag carries the row alone.
	 */
	resolveDragSet: ((file: TAbstractFile) => TAbstractFile[]) | null = null;

	/** Finds the row element for a file. Set by the view, which owns the DOM. */
	rowFor: ((file: TAbstractFile) => HTMLElement | null) | null = null;

	/** Every attached row, so the one under the pointer can be found again. */
	private readonly rows = new WeakMap<HTMLElement, DropTargetRow>();
	private container: HTMLElement | null = null;

	/**
	 * The window the current gesture is happening in. Obsidian can pop a leaf
	 * out into a window of its own, and that window has its own document — hit
	 * testing and the drag preview have to happen in the right one.
	 */
	private doc: Document = document;
	private win: Window = window;

	private press: Press | null = null;
	private sources: TAbstractFile[] = [];
	private ghost: HTMLElement | null = null;

	private indicated: DropTargetRow | null = null;
	private dwellRow: DropTargetRow | null = null;
	private dwellTimer: number | null = null;

	private scrollFrame: number | null = null;
	private scrollSpeed = 0;

	constructor(
		private readonly app: App,
		private readonly fileOps: FileOpsService,
		private readonly outline: OutlineService,
	) {}

	/** Wires a tree row up as both a drag source and a drop target. */
	attachRow(row: DropTargetRow): void {
		this.rows.set(row.rowEl, row);
		row.rowEl.addEventListener("pointerdown", (event) => this.onPointerDown(event, row));
	}

	/** The vault root accepts drops on the empty space below the tree. */
	attachRootTarget(el: HTMLElement): void {
		this.container = el;
	}

	// --- The press ---------------------------------------------------------

	private onPointerDown(event: PointerEvent, row: DropTargetRow): void {
		// Left button only; the right one belongs to the context menu.
		if (event.button !== 0 || this.press) return;
		// An inline rename owns its own pointer: selecting text is not a drag.
		if (event.target instanceof HTMLInputElement) return;

		this.doc = row.rowEl.ownerDocument;
		this.win = this.doc.defaultView ?? window;

		const touch = event.pointerType === "touch";
		this.press = {
			row,
			pointerId: event.pointerId,
			touch,
			x: event.clientX,
			y: event.clientY,
			armed: false,
			timer: null,
		};

		if (touch) {
			this.press.timer = this.win.setTimeout(() => this.arm(event), LONG_PRESS_MS);
		}

		this.win.addEventListener("pointermove", this.onPointerMove);
		this.win.addEventListener("pointerup", this.onPointerUp);
		this.win.addEventListener("pointercancel", this.onPointerCancel);
		// Escape gives a drag back: the browser used to do this for us.
		this.win.addEventListener("keydown", this.onKeyDown, true);
		// A long press would otherwise raise the platform's own menu on top.
		this.win.addEventListener("contextmenu", this.blockContextMenu, true);
		// Non-passive: while a finger is dragging, the tree must not scroll under it.
		this.win.addEventListener("touchmove", this.blockTouchScroll, { passive: false });
	}

	/** The long press landed: the row is now held, waiting to move or be let go. */
	private arm(event: PointerEvent): void {
		if (!this.press) return;
		this.press.timer = null;
		this.press.armed = true;
		this.press.row.rowEl.addClass("treenav-is-held");
		this.startDrag(event.clientX, event.clientY);
	}

	private onPointerMove = (event: PointerEvent): void => {
		const press = this.press;
		if (!press || event.pointerId !== press.pointerId) return;

		if (this.sources.length === 0) {
			const far = Math.hypot(event.clientX - press.x, event.clientY - press.y);
			if (press.touch) {
				// Moving before the long press means the finger is scrolling.
				if (far > TOUCH_SLOP) this.reset();
				return;
			}
			if (far < MOUSE_SLOP) return;
			this.startDrag(event.clientX, event.clientY);
			if (this.sources.length === 0) return;
		}

		event.preventDefault();
		this.trackPointer(event.clientX, event.clientY);
	};

	private onPointerUp = (event: PointerEvent): void => {
		const press = this.press;
		if (!press || event.pointerId !== press.pointerId) return;

		const dragging = this.sources.length > 0;
		const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y) > TOUCH_SLOP;
		if (dragging) swallowNextClick(this.win);
		const target = dragging ? this.rowAt(event.clientX, event.clientY) : null;
		const mode = target ? this.resolveMode(event.clientX, event.clientY, target) : null;
		const sources = this.sources;
		const armed = press.armed;

		this.reset();

		if (dragging && sources.length > 0) {
			if (target && mode) {
				void this.execute(sources, target.file, mode);
				return;
			}
			// Released over the tree but not over a row: the vault root.
			if (!target && this.isOverContainer(event.clientX, event.clientY)) {
				const root = this.app.vault.getRoot();
				if (sources.some((source) => this.canMoveInto(source, root))) {
					void this.moveAll(sources, root);
					return;
				}
			}
		}

		// Held in place and let go: what a long press means everywhere else.
		if (armed && !moved) press.row.showContextMenu(event);
	};

	private onPointerCancel = (event: PointerEvent): void => {
		if (this.press && event.pointerId !== this.press.pointerId) return;
		this.reset();
	};

	/** Escape abandons the drag, leaving the vault exactly as it was. */
	private onKeyDown = (event: KeyboardEvent): void => {
		if (event.key !== "Escape" || !this.press) return;
		const dragging = this.sources.length > 0;
		this.reset();
		// Only swallow it when it actually called something off, so Escape still
		// reaches the tree when nothing is being dragged.
		if (dragging) {
			event.preventDefault();
			event.stopPropagation();
		}
	};

	private blockContextMenu = (event: Event): void => {
		// Only the one the long press itself raises; a real right-click has no press.
		if (this.press?.touch) event.preventDefault();
	};

	private blockTouchScroll = (event: Event): void => {
		if (this.sources.length > 0) event.preventDefault();
	};

	// --- The drag ----------------------------------------------------------

	private startDrag(x: number, y: number): void {
		const press = this.press;
		if (!press) return;

		const set = this.resolveDragSet?.(press.row.file) ?? [];
		this.sources = set.length > 0 ? set : [press.row.file];
		this.markDragging(true);
		this.showGhost(press.row, x, y);
		this.trackPointer(x, y);
	}

	/** Follows the pointer: the preview, the drop indicator and the edge scroll. */
	private trackPointer(x: number, y: number): void {
		if (this.ghost) {
			this.ghost.style.transform = `translate(${x + 12}px, ${y + 12}px)`;
		}

		const row = this.rowAt(x, y);
		const mode = row ? this.resolveMode(x, y, row) : null;

		if (row && mode) this.setIndicator(row, mode);
		else this.clearIndicator();

		this.updateRootTarget(!row && this.isOverContainer(x, y));
		this.updateDwell(row, mode);
		this.updateEdgeScroll(y);
	}

	/** Empty space below the tree is the vault root, and says so. */
	private updateRootTarget(over: boolean): void {
		const root = this.app.vault.getRoot();
		const takes = over && this.sources.some((source) => this.canMoveInto(source, root));
		this.container?.toggleClass("treenav-is-drop-target", takes);
	}

	/** Hovering a collapsed folder opens it, so nested targets are reachable. */
	private updateDwell(row: DropTargetRow | null, mode: DropMode | null): void {
		const wants = mode === "into" && row?.isFolder ? row : null;
		if (wants === this.dwellRow) return;

		this.dwellRow = wants;
		if (this.dwellTimer !== null) this.win.clearTimeout(this.dwellTimer);
		this.dwellTimer = null;
		if (!wants) return;

		this.dwellTimer = this.win.setTimeout(() => {
			this.dwellTimer = null;
			wants.setExpanded(true);
		}, DWELL_MS);
	}

	/** Dragging against the top or bottom edge scrolls the tree along. */
	private updateEdgeScroll(y: number): void {
		const el = this.container;
		if (!el) return;

		const rect = el.getBoundingClientRect();
		if (rect.height === 0) return;

		if (y < rect.top + EDGE_PX) this.scrollSpeed = -EDGE_SPEED;
		else if (y > rect.bottom - EDGE_PX) this.scrollSpeed = EDGE_SPEED;
		else this.scrollSpeed = 0;

		if (this.scrollSpeed === 0 || this.scrollFrame !== null) return;

		const step = () => {
			if (this.scrollSpeed === 0 || this.sources.length === 0) {
				this.scrollFrame = null;
				return;
			}
			el.scrollTop += this.scrollSpeed;
			this.scrollFrame = this.win.requestAnimationFrame(step);
		};
		this.scrollFrame = this.win.requestAnimationFrame(step);
	}

	/** The row under the pointer, or `null` for empty space. */
	private rowAt(x: number, y: number): DropTargetRow | null {
		const el = this.doc.elementFromPoint(x, y);
		const rowEl = el instanceof Element ? el.closest(".treenav-item-self") : null;
		if (!(rowEl instanceof HTMLElement)) return null;
		return this.rows.get(rowEl) ?? null;
	}

	private isOverContainer(x: number, y: number): boolean {
		const el = this.container;
		if (!el) return false;
		const rect = el.getBoundingClientRect();
		return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
	}

	/** A floating copy of what is moving, since nothing draws one for us. */
	private showGhost(row: DropTargetRow, x: number, y: number): void {
		const ghost = this.doc.body.createDiv({ cls: "treenav-drag-ghost" });
		ghost.createSpan({ cls: "treenav-drag-ghost-name", text: row.displayName });
		if (this.sources.length > 1) {
			ghost.createSpan({ cls: "treenav-drag-ghost-count", text: String(this.sources.length) });
		}
		ghost.style.transform = `translate(${x + 12}px, ${y + 12}px)`;
		this.ghost = ghost;
	}

	private markDragging(on: boolean): void {
		for (const source of this.sources) {
			this.rowFor?.(source)?.toggleClass("treenav-is-dragging", on);
		}
	}

	/** Puts everything back, whether the drag ended in a drop or in nothing. */
	private reset(): void {
		const press = this.press;
		if (press && press.timer !== null) this.win.clearTimeout(press.timer);
		press?.row.rowEl.removeClass("treenav-is-held");

		this.markDragging(false);
		this.sources = [];
		this.press = null;

		this.ghost?.detach();
		this.ghost = null;

		this.clearIndicator();
		this.container?.removeClass("treenav-is-drop-target");
		if (this.dwellTimer !== null) this.win.clearTimeout(this.dwellTimer);
		this.dwellTimer = null;
		this.dwellRow = null;

		this.scrollSpeed = 0;
		if (this.scrollFrame !== null) this.win.cancelAnimationFrame(this.scrollFrame);
		this.scrollFrame = null;

		this.win.removeEventListener("pointermove", this.onPointerMove);
		this.win.removeEventListener("pointerup", this.onPointerUp);
		this.win.removeEventListener("pointercancel", this.onPointerCancel);
		this.win.removeEventListener("keydown", this.onKeyDown, true);
		this.win.removeEventListener("contextmenu", this.blockContextMenu, true);
		this.win.removeEventListener("touchmove", this.blockTouchScroll);
	}

	// --- Intent ------------------------------------------------------------

	/**
	 * Reads the pointer position and returns the intent, or `null` to refuse.
	 * An intent stands if it suits any one of the dragged items.
	 */
	private resolveMode(x: number, y: number, row: DropTargetRow): DropMode | null {
		const sources = this.sources;
		// Dropping a set onto one of its own members means nothing.
		if (sources.length === 0 || sources.includes(row.file)) return null;

		const rect = row.rowEl.getBoundingClientRect();
		if (rect.height === 0) return null;
		const ratio = (y - rect.top) / rect.height;
		const any = (test: (source: TAbstractFile) => boolean) => sources.some(test);

		if (row.isFolder) {
			// The middle band drops into the folder; the edges reorder around it.
			if (ratio < 0.25) return this.checkReorder(row, "before");
			if (ratio > 0.75) return this.checkReorder(row, "after");
			return any((source) => this.canMoveInto(source, row.file as TFolder)) ? "into" : null;
		}

		const icon = row.iconEl.getBoundingClientRect();
		if (x >= icon.left - 4 && x <= icon.right + 4) {
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

	/** Only one row is ever marked, so no stale marker is left behind. */
	private setIndicator(row: DropTargetRow, mode: DropMode): void {
		if (this.indicated && this.indicated !== row) this.indicated.showDropIndicator(null);
		this.indicated = row;
		row.showDropIndicator(mode);
	}

	private clearIndicator(): void {
		this.indicated?.showDropIndicator(null);
		this.indicated = null;
	}
}

/**
 * Eats the click the browser fires after the pointer is released, so a drag
 * that ended on a row does not also open it. Removed on a timer in case no
 * click follows at all, which is what happens after a touch drag.
 */
function swallowNextClick(win: Window): void {
	const swallow = (event: MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		done();
	};
	const done = () => {
		win.removeEventListener("click", swallow, true);
		win.clearTimeout(timer);
	};
	const timer = win.setTimeout(done, 300);
	win.addEventListener("click", swallow, true);
}
