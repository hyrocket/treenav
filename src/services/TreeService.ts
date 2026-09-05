import { TAbstractFile, TFile, TFolder } from "obsidian";
import { StateStore } from "../state/StateStore";
import { SortMode } from "../types";
import { FolderNoteService } from "./FolderNoteService";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Sorts after every ordered item, so new files land at the end of the folder. */
const UNORDERED = Number.MAX_SAFE_INTEGER;

function compareNames(a: TAbstractFile, b: TAbstractFile): number {
	return collator.compare(a.name, b.name);
}

function rank(file: TAbstractFile, mode: SortMode): number {
	if (mode === "mixed") return 0;
	const isFolder = file instanceof TFolder;
	if (mode === "folders-first") return isFolder ? 0 : 1;
	return isFolder ? 1 : 0;
}

/** Decides which children of a folder are shown and in which order. */
export class TreeService {
	constructor(
		private readonly state: StateStore,
		private readonly folderNotes: FolderNoteService,
	) {}

	getVisibleChildren(folder: TFolder): TAbstractFile[] {
		const settings = this.state.settings;
		const visible: TAbstractFile[] = [];

		for (const child of folder.children) {
			if (child instanceof TFolder) {
				visible.push(child);
				continue;
			}
			const file = child as TFile;
			if (!settings.showNonMarkdownFiles && file.extension !== "md") continue;
			if (settings.hideFolderNoteFiles && this.folderNotes.isFolderNote(file)) continue;
			visible.push(file);
		}

		// A folder the user has reordered by dragging keeps that order; every
		// other folder follows the global sort setting.
		const manual = visible.some((file) => this.state.getOrder(file.path) !== undefined);
		if (manual) {
			visible.sort(
				(a, b) =>
					(this.state.getOrder(a.path) ?? UNORDERED) -
						(this.state.getOrder(b.path) ?? UNORDERED) || compareNames(a, b),
			);
			return visible;
		}

		const mode = settings.sortMode;
		visible.sort((a, b) => rank(a, mode) - rank(b, mode) || compareNames(a, b));
		return visible;
	}
}
