import { TAbstractFile, TFolder, setIcon } from "obsidian";
import { StateStore } from "../state/StateStore";
import { FontFamily, FontToken, TreeNavStyle } from "../types";

/**
 * A folder you made is a folder and looks like one. A folder TreeNav created by
 * nesting is really a note that gained children, so it keeps the note icon —
 * that way the round trip of nesting and un-nesting never makes a note appear
 * to become something else and then an empty folder.
 */
// `folder-closed` over `folder`: the plain one has no lid line and reads as
// open. This is also what the core file explorer uses.
const FOLDER_ICON = "folder-closed";

/** Typeface tokens resolve to the running theme's own variables. */
const FONT_STACKS: Record<FontToken, string> = {
	interface: "var(--font-interface)",
	text: "var(--font-text)",
	monospace: "var(--font-monospace)",
};

/** An unknown value resolves to nothing, leaving the row on the theme font. */
export function resolveFontFamily(value: FontFamily | undefined): string {
	return (value && FONT_STACKS[value]) ?? "";
}
const NOTE_ICON = "file-text";

const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const VARIATION_SELECTOR = "️";

/** Distinguishes a stored emoji from a registered icon id. */
export function isEmoji(icon: string): boolean {
	return PICTOGRAPHIC.test(icon);
}

/**
 * Forces the colour form of an emoji. Characters such as U+270F default to a
 * monochrome text glyph, which would then take the row's colour instead of
 * bringing its own. Only single code points are touched — appending to a
 * sequence such as a flag or a family would break it.
 */
export function withEmojiPresentation(emoji: string): string {
	const points = [...emoji];
	if (points.length !== 1 || emoji.endsWith(VARIATION_SELECTOR)) return emoji;
	return emoji + VARIATION_SELECTOR;
}

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
		rowEl.style.fontFamily = resolveFontFamily(style?.fontFamily);
		rowEl.style.fontWeight = style?.fontWeight ?? "";
		rowEl.style.fontStyle = style?.fontStyle ?? "";
		rowEl.style.fontSize = style?.fontSize ? `${style.fontSize}px` : "";
	}

	/**
	 * Paints the highlight behind the name.
	 *
	 * The title is its own element and normally stretches to the end of the row,
	 * so a background on it would be a bar rather than a highlighter. Shrinking
	 * it to its text is what makes it read as one; the class does that, and the
	 * name still gets its ellipsis when there is no room.
	 */
	applyToTitle(titleEl: HTMLElement, path: string): void {
		const background = this.get(path)?.background;
		titleEl.style.backgroundColor = background ?? "";
		titleEl.toggleClass("treenav-has-highlight", !!background);
	}

	/**
	 * Fills the row's icon slot. The slot is always reserved, so a custom icon
	 * never shifts a title out of line with its neighbours.
	 */
	applyToIcon(iconEl: HTMLElement, file: TAbstractFile): void {
		this.renderIcon(iconEl, file, this.get(file.path)?.icon);
	}

	/**
	 * Draws `icon` in the slot, falling back to the default for `file`. Taking
	 * the icon as an argument lets a dialog preview one before it is stored.
	 */
	renderIcon(iconEl: HTMLElement, file: TAbstractFile, custom: string | undefined): void {
		iconEl.empty();

		if (custom) {
			iconEl.removeClass("treenav-is-default-icon");
			// An emoji is a glyph, not a registered icon: it goes in as text, and
			// keeps its own colours rather than following the row.
			iconEl.toggleClass("treenav-is-emoji", isEmoji(custom));
			if (isEmoji(custom)) iconEl.setText(custom);
			else setIcon(iconEl, custom);
			return;
		}

		iconEl.removeClass("treenav-is-emoji");
		iconEl.addClass("treenav-is-default-icon");
		if (!this.state.settings.showDefaultIcons) return;

		const isRealFolder = file instanceof TFolder && !this.state.isNested(file.path);
		setIcon(iconEl, isRealFolder ? FOLDER_ICON : NOTE_ICON);
	}
}
