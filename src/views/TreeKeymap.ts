import { Platform, TFolder } from "obsidian";
import { TreeItem } from "../components/TreeItem";
import { TreeRenderer } from "../components/TreeRenderer";
import { OutlineEdge } from "../services/OutlineService";

/**
 * What the tree can do in response to a key. Implemented by TreeNavView.
 *
 * The names are deliberately verbose: TreeNavView extends Obsidian's `View`,
 * whose runtime class carries undocumented members (`open`, `close`, `load`, …)
 * that are absent from obsidian.d.ts. Shadowing one of those compiles cleanly
 * and then breaks the view at runtime, so nothing here uses a bare verb.
 */
export interface TreeKeymapActions {
	openItem(item: TreeItem): void;
	renameItem(item: TreeItem): void;
	deleteItem(item: TreeItem): void;
	createNoteIn(folder: TFolder): void;
	createFolderIn(folder: TFolder): void;
	getTargetFolder(): TFolder;
	moveStep(item: TreeItem, delta: -1 | 1): void;
	moveToEdge(item: TreeItem, edge: OutlineEdge): void;
	indentItem(item: TreeItem): void;
	outdentItem(item: TreeItem): void;
}

/**
 * Keyboard navigation, kept apart from the view so the key table stays readable
 * and can grow without dragging the rest of the view along with it.
 *
 * The modifier is Cmd on macOS and Ctrl elsewhere. Handled keys are consumed so
 * they never reach Obsidian's global shortcuts (Ctrl+N would otherwise create a
 * note in the wrong place).
 *
 * Shift+arrow moves the item rather than extending the selection: this tree is
 * an outline you can rearrange, and that is the more useful thing to reach for.
 * Ranges are picked up with Shift+click instead.
 */
export class TreeKeymap {
	constructor(
		private readonly renderer: TreeRenderer,
		private readonly actions: TreeKeymapActions,
	) {}

	handle(event: KeyboardEvent): void {
		// While an inline rename is open the input owns every key.
		if (event.target instanceof HTMLInputElement) return;

		const mod = Platform.isMacOS ? event.metaKey : event.ctrlKey;

		if (mod && event.key.toLowerCase() === "n") {
			const folder = this.actions.getTargetFolder();
			if (event.shiftKey) this.actions.createFolderIn(folder);
			else this.actions.createNoteIn(folder);
			return consume(event);
		}

		if (mod && event.key.toLowerCase() === "a") {
			this.renderer.selectAll();
			return consume(event);
		}

		const selected = this.renderer.getSelected();

		// Shift moves the item itself; the bare arrows move the selection.
		if (event.shiftKey && selected && this.moveSelected(selected, event.key)) {
			return consume(event);
		}

		switch (event.key) {
			case "ArrowDown":
				this.step(1);
				return consume(event);

			case "ArrowUp":
				this.step(-1);
				return consume(event);

			case "ArrowRight":
				if (selected) this.expandOrDescend(selected);
				return consume(event);

			case "ArrowLeft":
				if (selected) this.collapseOrAscend(selected);
				return consume(event);

			case "Home":
				this.moveTo(this.renderer.getVisibleItems()[0]);
				return consume(event);

			case "End": {
				const items = this.renderer.getVisibleItems();
				this.moveTo(items[items.length - 1]);
				return consume(event);
			}

			case "Enter":
				if (selected) this.actions.openItem(selected);
				return consume(event);

			case "F2":
				if (selected) this.actions.renameItem(selected);
				return consume(event);

			case "Backspace":
				// Only macOS, where this is the main delete key; elsewhere
				// Backspace is too easy to hit by accident.
				if (!Platform.isMacOS) return;
				if (selected) this.actions.deleteItem(selected);
				return consume(event);

			case "Delete":
				if (selected) this.actions.deleteItem(selected);
				return consume(event);

			case "Escape":
				// Only when it has something to undo, so Escape still reaches
				// Obsidian when the tree has nothing to narrow.
				if (this.renderer.collapseSelection()) return consume(event);
				return;

			default:
				return;
		}
	}

	/** Handles the Shift+arrow family; returns `false` for keys it does not own. */
	private moveSelected(item: TreeItem, key: string): boolean {
		switch (key) {
			case "ArrowUp":
				this.actions.moveStep(item, -1);
				return true;
			case "ArrowDown":
				this.actions.moveStep(item, 1);
				return true;
			case "ArrowLeft":
				this.actions.outdentItem(item);
				return true;
			case "ArrowRight":
				this.actions.indentItem(item);
				return true;
			case "Home":
				this.actions.moveToEdge(item, "top");
				return true;
			case "End":
				this.actions.moveToEdge(item, "bottom");
				return true;
			default:
				return false;
		}
	}

	/** Moves the selection by `delta` rows, starting at the top when nothing is selected. */
	private step(delta: number): void {
		const items = this.renderer.getVisibleItems();
		if (items.length === 0) return;

		const selected = this.renderer.getSelected();
		if (!selected) {
			this.moveTo(delta > 0 ? items[0] : items[items.length - 1]);
			return;
		}

		const index = items.indexOf(selected);
		if (index === -1) {
			this.moveTo(items[0]);
			return;
		}

		this.moveTo(items[Math.min(Math.max(index + delta, 0), items.length - 1)]);
	}

	private expandOrDescend(item: TreeItem): void {
		if (!item.isFolder) return;
		if (!item.isExpanded) {
			item.setExpanded(true);
			return;
		}
		this.moveTo(item.children[0]);
	}

	private collapseOrAscend(item: TreeItem): void {
		if (item.isFolder && item.isExpanded) {
			item.setExpanded(false);
			return;
		}
		this.moveTo(this.renderer.getParentItem(item));
	}

	private moveTo(item: TreeItem | undefined): void {
		if (!item) return;
		this.renderer.select(item);
		item.scrollIntoView();
	}
}

function consume(event: KeyboardEvent): void {
	event.preventDefault();
	event.stopPropagation();
}
