import { TAbstractFile, TFolder, setIcon } from "obsidian";
import { StateStore } from "../state/StateStore";
import { TreeNavStyle } from "../types";

/**
 * A folder you made is a folder and looks like one. A folder TreeNav created by
 * nesting is really a note that gained children, so it keeps the note icon —
 * that way the round trip of nesting and un-nesting never makes a note appear
 * to become something else and then an empty folder.
 */
// `folder-closed` over `folder`: the plain one has no lid line and reads as
// open. This is also what the core file explorer uses.
const FOLDER_ICON = "folder-closed";
const NOTE_ICON = "file-text";

/**
 * Per-item appearance: icon, colour and font overrides.
 *
 * Styles are keyed by vault path because Obsidian exposes no stable file id.
 * The store migrates those keys on every rename, so an entry survives a file
 * being renamed or a whole folder being moved.
 */
export class StyleService {
	constructor(private readonly state: StateStore) {}

	get(path: string): TreeNavStyle | undefined {
		return this.state.getStyle(path);
	}

	has(path: string): boolean {
		return this.state.hasStyle(path);
	}

	update(path: string, patch: Partial<TreeNavStyle>): void {
		this.state.setStyle(path, patch);
	}

	clear(path: string): void {
		this.state.clearStyle(path);
	}

	/** Writes the style onto a row. Cleared properties fall back to the theme. */
	applyToRow(rowEl: HTMLElement, path: string): void {
		const style = this.get(path);
		rowEl.style.color = style?.color ?? "";
		rowEl.style.fontWeight = style?.fontWeight ?? "";
		rowEl.style.fontStyle = style?.fontStyle ?? "";
		rowEl.style.fontSize = style?.fontSize ? `${style.fontSize}px` : "";
	}

	/**
	 * Fills the row's icon slot. The slot is always reserved, so a custom icon
	 * never shifts a title out of line with its neighbours.
	 */
	applyToIcon(iconEl: HTMLElement, file: TAbstractFile): void {
		iconEl.empty();

		const custom = this.get(file.path)?.icon;
		if (custom) {
			iconEl.removeClass("treenav-is-default-icon");
			setIcon(iconEl, custom);
			return;
		}

		iconEl.addClass("treenav-is-default-icon");
		if (!this.state.settings.showDefaultIcons) return;

		const isRealFolder = file instanceof TFolder && !this.state.isNested(file.path);
		setIcon(iconEl, isRealFolder ? FOLDER_ICON : NOTE_ICON);
	}
}
