import { TAbstractFile, TFile, TFolder } from "obsidian";
import { outermost } from "../state/paths";
import { StateStore } from "../state/StateStore";
import { FileOpsService } from "./FileOpsService";
import { TreeService } from "./TreeService";

export type OutlineEdge = "top" | "bottom";
export type OutlinePosition = "before" | "after";

/**
 * Moving items around the outline: reordering within a folder, and changing
 * depth.
 *
 * Indent and outdent are the keyboard form of the drag gestures. Indenting
 * under a note reuses nesting — the note becomes a folder note and adopts the
 * item — so there is one set of rules no matter how the move was started.
 *
 * A folder gets a manual order the moment anything here writes one, freezing
 * what the tree was already showing plus the move that was asked for.
 */
export class OutlineService {
	/** Called with the folder whose listing changed; no vault event reports a reorder. */
	onChanged: ((folderPath: string) => void) | null = null;

	constructor(
		private readonly fileOps: FileOpsService,
		private readonly tree: TreeService,
		private readonly state: StateStore,
	) {}

	/** Places `source` directly before or after `target`, moving folders if needed. */
	async placeNextTo(
		source: TAbstractFile,
		target: TAbstractFile,
		position: OutlinePosition,
	): Promise<void> {
		const parent = target.parent;
		if (!parent || source === target) return;

		if (source.parent !== parent) {
			const moved = await this.fileOps.move(source, parent);
			if (!moved.ok) return;
		}

		const siblings = this.tree.getVisibleChildren(parent).filter((file) => file !== source);
		const index = siblings.indexOf(target);
		if (index === -1) return;

		siblings.splice(position === "before" ? index : index + 1, 0, source);
		this.commit(parent, siblings);
	}

	/**
	 * The same, for several items at once, keeping the order they were in.
	 *
	 * Dropping after a row inserts each one directly below it, so working
	 * backwards is what leaves the set in its original order. A folder in the
	 * set brings its own contents, so those are not moved again on their own.
	 */
	async placeAllNextTo(
		sources: TAbstractFile[],
		target: TAbstractFile,
		position: OutlinePosition,
	): Promise<void> {
		const carried = outermost(sources);
		const ordered = position === "after" ? [...carried].reverse() : carried;
		for (const source of ordered) {
			if (source !== target) await this.placeNextTo(source, target, position);
		}
	}

	/**
	 * Drops several items into `folder`, as a drop onto a folder row does.
	 *
	 * A folder the user has put in order takes them at the bottom, in the order
	 * they were given — the same place a new note lands. A sorted folder files
	 * them by name like anything else, and stays sorted. Whatever cannot go in
	 * stays where it is, and a folder in the set carries its contents rather
	 * than having them moved in beside it.
	 *
	 * One at a time: two moves at once can race for the same name.
	 */
	async moveAllInto(sources: TAbstractFile[], folder: TFolder): Promise<void> {
		const arrived: TAbstractFile[] = [];
		for (const source of outermost(sources)) {
			if (source.parent === folder || this.fileOps.checkMove(source, folder) !== null) continue;
			const moved = await this.fileOps.move(source, folder);
			if (moved.ok) arrived.push(source);
		}
		if (arrived.length === 0 || !this.state.hasOrder(folder.path)) return;

		const listing = this.tree.getVisibleChildren(folder);
		const stayed = listing.filter((file) => !arrived.includes(file));
		const landed = arrived.filter((file) => listing.includes(file));
		this.commit(folder, [...stayed, ...landed]);
	}

	/** Moves one place up (`-1`) or down (`+1`) among its visible siblings. */
	moveStep(file: TAbstractFile, delta: -1 | 1): void {
		const parent = file.parent;
		if (!parent) return;

		const siblings = this.tree.getVisibleChildren(parent);
		const index = siblings.indexOf(file);
		const target = index + delta;
		if (index === -1 || target < 0 || target >= siblings.length) return;

		siblings.splice(index, 1);
		siblings.splice(target, 0, file);
		this.commit(parent, siblings);
	}

	moveToEdge(file: TAbstractFile, edge: OutlineEdge): void {
		const parent = file.parent;
		if (!parent) return;

		const siblings = this.tree.getVisibleChildren(parent);
		const index = siblings.indexOf(file);
		if (index === -1) return;

		siblings.splice(index, 1);
		if (edge === "top") siblings.unshift(file);
		else siblings.push(file);
		this.commit(parent, siblings);
	}

	/**
	 * One level deeper: the item goes under the sibling above it. A folder takes
	 * it in directly; a note becomes a folder note and adopts it.
	 */
	async indent(file: TAbstractFile): Promise<void> {
		const parent = file.parent;
		if (!parent) return;

		const siblings = this.tree.getVisibleChildren(parent);
		const index = siblings.indexOf(file);
		// The first item has nothing above it to go under.
		if (index <= 0) return;

		const target = siblings[index - 1];
		if (target instanceof TFolder) {
			const moved = await this.fileOps.move(file, target);
			if (!moved.ok) return;
			this.state.setExpanded(target.path, true);
			this.onChanged?.(target.path);
			return;
		}

		await this.nestUnder(file, target as TFile);
	}

	/**
	 * One level shallower: the item leaves its folder and lands directly after
	 * it among its former parent's siblings.
	 */
	async outdent(file: TAbstractFile): Promise<void> {
		const parent = file.parent;
		// Already at the top level; `placeNextTo` would have nowhere to put it.
		if (!parent || !parent.parent) return;
		await this.placeNextTo(file, parent, "after");
	}

	/** Turns `note` into a folder note holding `source`. */
	async nestUnder(source: TAbstractFile, note: TFile): Promise<void> {
		// Read before the note moves into its folder, which leaves this behind.
		const position = this.state.getOrder(note.path);
		const result = await this.fileOps.nestUnder(source, note);
		if (!result.ok || !result.value) return;

		const { folder, created } = result.value;
		if (created) {
			// Only a folder TreeNav conjured out of a note may be undone later.
			this.state.markNested(folder.path);
			// The folder's row now stands exactly where the note's row was, so it
			// takes over the note's position and appearance.
			this.state.inherit(note.path, folder.path, position);
		}
		this.state.setExpanded(folder.path, true);
		this.onChanged?.(folder.path);
	}

	private commit(folder: TFolder, ordered: TAbstractFile[]): void {
		this.state.setOrder(ordered.map((file) => file.path));
		this.onChanged?.(folder.path);
	}
}
