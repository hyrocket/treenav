import { App, PluginSettingTab, Setting } from "obsidian";
import type TreeNavPlugin from "../main";
import { FlattenMode, SortMode, TreeStyle } from "../types";

const TREE_STYLE_LABELS: Record<TreeStyle, string> = {
	modern: "Modern",
	classic: "Classic",
};

const FLATTEN_LABELS: Record<FlattenMode, string> = {
	ask: "Ask each time",
	always: "Turn it back into a note",
	never: "Keep the folder",
};

const SORT_LABELS: Record<SortMode, string> = {
	"folders-first": "Folders first",
	"files-first": "Files first",
	mixed: "Alphabetical",
};

export class TreeNavSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: TreeNavPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const settings = this.plugin.state.settings;
		const commit = async (rerender: boolean) => {
			await this.plugin.state.save();
			if (rerender) this.plugin.refreshViews();
		};

		new Setting(containerEl).setName("General").setHeading();

		new Setting(containerEl)
			.setName("Open folder note when clicking a folder")
			.setDesc("Clicking a folder name opens its folder note instead of only expanding it.")
			.addToggle((toggle) =>
				toggle.setValue(settings.openFolderNoteOnClick).onChange(async (value) => {
					settings.openFolderNoteOnClick = value;
					await commit(false);
				}),
			);

		new Setting(containerEl)
			.setName("Create folder notes automatically")
			.setDesc("Clicking a folder without a folder note creates one. Turn this off to only expand the folder.")
			.addToggle((toggle) =>
				toggle.setValue(settings.autoCreateFolderNote).onChange(async (value) => {
					settings.autoCreateFolderNote = value;
					await commit(false);
				}),
			);

		new Setting(containerEl)
			.setName("Hide folder notes")
			.setDesc("Keep a folder note out of its own folder listing.")
			.addToggle((toggle) =>
				toggle.setValue(settings.hideFolderNoteFiles).onChange(async (value) => {
					settings.hideFolderNoteFiles = value;
					await commit(true);
				}),
			);

		new Setting(containerEl)
			.setName("Remember expanded folders")
			.setDesc("Restore which folders were open after a restart.")
			.addToggle((toggle) =>
				toggle.setValue(settings.rememberExpandedFolders).onChange(async (value) => {
					settings.rememberExpandedFolders = value;
					await commit(false);
				}),
			);

		new Setting(containerEl).setName("Shortcuts").setHeading();

		new Setting(containerEl)
			.setName("Custom shortcuts")
			.setDesc(
				"Every TreeNav action is a command, so any key can be bound to it under Settings → Hotkeys (search for \"TreeNav\"). They only fire while the tree has keyboard focus, so a single-letter shortcut is safe to use — click a row once to give the tree focus. Built in already: arrows to move, Shift+arrows to move the item, Enter to open, F2 to rename, Delete to remove, Ctrl/Cmd+N for a new note.",
			);

		new Setting(containerEl).setName("Sorting").setHeading();

		new Setting(containerEl)
			.setName("Order")
			.setDesc(
				"How items are ordered inside a folder. Alphabetical keeps a note in place when nesting turns it into a folder; the other modes list folders and notes as separate groups, so it will jump between them. A folder whose items you have dragged into place keeps that order instead — reset it from the folder's context menu.",
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOptions(SORT_LABELS)
					.setValue(settings.sortMode)
					.onChange(async (value) => {
						settings.sortMode = value as SortMode;
						await commit(true);
					}),
			);

		new Setting(containerEl)
			.setName("Show non-markdown files")
			.setDesc("Also list images, PDFs and other attachments.")
			.addToggle((toggle) =>
				toggle.setValue(settings.showNonMarkdownFiles).onChange(async (value) => {
					settings.showNonMarkdownFiles = value;
					await commit(true);
				}),
			);

		new Setting(containerEl).setName("Appearance").setHeading();

		new Setting(containerEl)
			.setName("Tree style")
			.setDesc(
				"Modern uses plain indentation with a light guide. Classic draws the boxed connector lines of a traditional tree view.",
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOptions(TREE_STYLE_LABELS)
					.setValue(settings.treeStyle)
					.onChange(async (value) => {
						settings.treeStyle = value as TreeStyle;
						await commit(true);
					}),
			);

		new Setting(containerEl)
			.setName("Show default icons")
			.setDesc(
				"Draw a folder or note icon on items that have no icon of their own. Icons set on individual items are always shown.",
			)
			.addToggle((toggle) =>
				toggle.setValue(settings.showDefaultIcons).onChange(async (value) => {
					settings.showDefaultIcons = value;
					await this.plugin.state.save();
					this.plugin.refreshStyles();
				}),
			);

		new Setting(containerEl)
			.setName("When a nested folder loses its last child")
			.setDesc(
				"Dropping a note onto another turns the target into a folder. This is what happens when that folder is later left with nothing but its own note. Folders you made yourself are never affected.",
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOptions(FLATTEN_LABELS)
					.setValue(settings.flattenNestedFolders)
					.onChange(async (value) => {
						settings.flattenNestedFolders = value as FlattenMode;
						await commit(false);
					}),
			);

		new Setting(containerEl).setName("Behavior").setHeading();

		new Setting(containerEl)
			.setName("Confirm before deleting")
			.setDesc("Ask before moving a file or folder to the trash.")
			.addToggle((toggle) =>
				toggle.setValue(settings.confirmDelete).onChange(async (value) => {
					settings.confirmDelete = value;
					await commit(false);
				}),
			);
	}
}
