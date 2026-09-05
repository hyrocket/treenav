import { TAbstractFile, setIcon } from "obsidian";
import { StateStore } from "../state/StateStore";
import { TreeNavStyle } from "../types";

/**
 * One icon for folders and notes alike.
 *
 * Nesting a note under another turns the target into a folder, and pulling the
 * child back out leaves the folder behind. With separate folder and note icons
 * that round trip looks like the note became something else and then an empty
 * folder; with one icon it simply looks like the note it still is. Whether an
 * item holds anything is expressed by the collapse arrow instead.
 */
const DEFAULT_ICON = "file-text";

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
		setIcon(iconEl, DEFAULT_ICON);
	}
}
