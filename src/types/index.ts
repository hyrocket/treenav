export const TREENAV_VIEW_TYPE = "treenav-view";
export const TREENAV_ICON = "list-tree";

/**
 * How the tree draws depth. The two classic variants differ only in the line:
 * dots are traditional, but a hairline holds up better on a display that is
 * not at 100% scaling, where a 1px dot pattern starts to shimmer.
 */
export type TreeStyle = "modern" | "classic" | "classic-solid";

/** How siblings are ordered inside a folder. */
export type SortMode = "folders-first" | "files-first" | "mixed";

/** What to do when a folder created by nesting loses its last child. */
export type FlattenMode = "always" | "never" | "ask";

/** Tokens that resolve to whatever the running theme defines. */
export const FONT_TOKENS = ["interface", "text", "monospace"] as const;
export type FontToken = (typeof FONT_TOKENS)[number];

/**
 * Either a token above, or any font stack the user typed.
 *
 * A token travels: it follows the theme and means the same thing on a machine
 * with different fonts installed. A literal name does not, but nothing stops
 * anyone from using one — CSS takes whatever it is given, and an unknown font
 * simply falls back.
 */
export type FontFamily = string;

export type FontWeight = "normal" | "bold";
export type FontStyle = "normal" | "italic";

/**
 * Per-item appearance. Every field is optional; an absent field means "inherit
 * the theme". An entry with no fields left is dropped rather than stored empty.
 */
export interface TreeNavStyle {
	icon?: string;
	color?: string;
	/** A `FontToken`, or a literal font stack. */
	fontFamily?: FontFamily;
	fontWeight?: FontWeight;
	fontStyle?: FontStyle;
	fontSize?: number;
}

export interface TreeNavSettings {
	sortMode: SortMode;
	/** Show files that are not markdown notes. */
	showNonMarkdownFiles: boolean;
	/** Clicking a folder title opens its folder note (when one exists). */
	openFolderNoteOnClick: boolean;
	/** Create the folder note on the first title click if it is missing. */
	autoCreateFolderNote: boolean;
	/** Keep folder notes out of the tree listing. */
	hideFolderNoteFiles: boolean;
	/** Persist expanded folders across restarts. */
	rememberExpandedFolders: boolean;
	/** Ask before moving an item to the trash. */
	confirmDelete: boolean;
	/** Draw a default icon on items with no icon of their own. */
	showDefaultIcons: boolean;
	/** Flat indentation, or the boxed connector lines of a classic tree view. */
	treeStyle: TreeStyle;
	/**
	 * What happens when a folder TreeNav created by nesting loses its last
	 * child: fold it back into a note, leave it alone, or ask.
	 */
	flattenNestedFolders: FlattenMode;
}

export const DEFAULT_SETTINGS: TreeNavSettings = {
	sortMode: "mixed",
	showNonMarkdownFiles: false,
	openFolderNoteOnClick: true,
	autoCreateFolderNote: true,
	hideFolderNoteFiles: true,
	rememberExpandedFolders: true,
	confirmDelete: true,
	showDefaultIcons: true,
	treeStyle: "modern",
	flattenNestedFolders: "ask",
};

/**
 * Shape persisted through `Plugin.saveData`.
 *
 * Everything that is keyed by a vault path lives in its own top-level map so a
 * rename can be applied to every map by the same prefix-rewrite pass. Phase 2
 * adds `styles` here without changing that mechanism.
 */
export interface TreeNavData {
	version: number;
	settings: TreeNavSettings;
	expandedFolders: string[];
	/** Keyed by vault path; migrated wholesale when something is renamed. */
	styles: Record<string, TreeNavStyle>;
	/**
	 * Manual position of an item inside its folder, keyed by the item's own
	 * path so it migrates through the same rename pass as everything else.
	 * A folder is manually ordered as soon as any of its children appears here.
	 */
	order: Record<string, number>;
	/**
	 * Folders TreeNav created by nesting a note under another. Only these may be
	 * flattened again — folders the user made are never touched.
	 */
	nestedFolders: string[];
}

export const DATA_VERSION = 1;
