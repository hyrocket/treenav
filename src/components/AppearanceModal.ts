import { App, ButtonComponent, Modal, Setting, TAbstractFile } from "obsidian";
import { StyleService, resolveFontFamily } from "../services/StyleService";
import { FontFamily, TreeNavStyle } from "../types";
import { IconPickerModal } from "./IconPickerModal";

/**
 * Obsidian's own accent colours, so a coloured item still belongs to the
 * active theme in both light and dark mode.
 */
const SWATCHES: { name: string; value: string }[] = [
	{ name: "Red", value: "var(--color-red)" },
	{ name: "Orange", value: "var(--color-orange)" },
	{ name: "Yellow", value: "var(--color-yellow)" },
	{ name: "Green", value: "var(--color-green)" },
	{ name: "Cyan", value: "var(--color-cyan)" },
	{ name: "Blue", value: "var(--color-blue)" },
	{ name: "Purple", value: "var(--color-purple)" },
	{ name: "Pink", value: "var(--color-pink)" },
	{ name: "Muted", value: "var(--text-muted)" },
	{ name: "Faint", value: "var(--text-faint)" },
];

const TYPEFACES: Record<string, string> = {
	"": "Theme default",
	interface: "Interface",
	text: "Text",
	monospace: "Monospace",
};

const DEFAULT_SIZE = 13;

/**
 * Everything about how one row looks, in one dialog.
 *
 * Icon, colour and font used to be three separate menu entries opening three
 * dialogs, which meant three round trips to style a single item and no way to
 * see how the parts came out together. Here the row is drawn at the top and
 * follows every change, so the decision is made against the result rather than
 * against a list of property names. Nothing reaches the vault until Apply.
 */
export class AppearanceModal extends Modal {
	private draft: TreeNavStyle;
	private previewIconEl!: HTMLElement;
	private previewTitleEl!: HTMLElement;
	private swatchEls: HTMLElement[] = [];
	private boldButton!: ButtonComponent;
	private italicButton!: ButtonComponent;

	constructor(
		app: App,
		private readonly file: TAbstractFile,
		private readonly displayName: string,
		private readonly styles: StyleService,
		private readonly onSubmit: (style: TreeNavStyle) => void,
	) {
		super(app);
		this.draft = { ...styles.get(file.path) };
	}

	onOpen(): void {
		this.titleEl.setText("Font & Color");
		this.modalEl.addClass("treenav-appearance-modal");

		this.buildPreview();
		this.buildIcon();
		this.buildColor();
		this.buildText();
		this.buildFooter();

		this.refreshPreview();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	/** The row as it will look, drawn the way the tree draws it. */
	private buildPreview(): void {
		const preview = this.contentEl.createDiv({ cls: "treenav-appearance-preview" });
		const row = preview.createDiv({ cls: "treenav-item-self" });
		this.previewIconEl = row.createDiv({ cls: "treenav-item-icon" });
		this.previewTitleEl = row.createDiv({
			cls: "treenav-item-title",
			text: this.displayName,
		});
	}

	private buildIcon(): void {
		new Setting(this.contentEl)
			.setName("Icon")
			.setDesc("A theme icon, or an emoji.")
			.addButton((button) =>
				button.setButtonText("Choose…").onClick(() => {
					new IconPickerModal(this.app, this.draft.icon, (icon) => {
						this.draft.icon = icon;
						this.refreshPreview();
					}).open();
				}),
			)
			.addExtraButton((button) =>
				button
					.setIcon("rotate-ccw")
					.setTooltip("Use the default icon")
					.onClick(() => this.set({ icon: undefined })),
			);
	}

	private buildColor(): void {
		const setting = new Setting(this.contentEl)
			.setName("Color")
			.setDesc("Colors the name. An emoji icon keeps its own colors.");

		setting.addColorPicker((picker) =>
			picker
				.setValue(normalizeHex(this.draft.color) ?? "#888888")
				.onChange((value) => this.set({ color: value })),
		);
		setting.addExtraButton((button) =>
			button
				.setIcon("rotate-ccw")
				.setTooltip("Use the theme color")
				.onClick(() => this.set({ color: undefined })),
		);

		const grid = this.contentEl.createDiv({ cls: "treenav-swatch-grid" });
		this.swatchEls = SWATCHES.map((swatch) => {
			const el = grid.createDiv({ cls: "treenav-swatch" });
			el.setAttribute("aria-label", swatch.name);
			el.style.backgroundColor = swatch.value;
			el.addEventListener("click", () => this.set({ color: swatch.value }));
			return el;
		});
	}

	private buildText(): void {
		new Setting(this.contentEl)
			.setName("Typeface")
			.setDesc("Follows the fonts the theme defines, so it travels between devices.")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions(TYPEFACES)
					.setValue(this.draft.fontFamily ?? "")
					.onChange((value) =>
						this.set({ fontFamily: (value || undefined) as FontFamily | undefined }),
					),
			);

		new Setting(this.contentEl)
			.setName("Emphasis")
			.addButton((button) => {
				this.boldButton = button;
				button
					.setIcon("bold")
					.setTooltip("Bold")
					.onClick(() =>
						this.set({ fontWeight: this.draft.fontWeight === "bold" ? undefined : "bold" }),
					);
			})
			.addButton((button) => {
				this.italicButton = button;
				button
					.setIcon("italic")
					.setTooltip("Italic")
					.onClick(() =>
						this.set({ fontStyle: this.draft.fontStyle === "italic" ? undefined : "italic" }),
					);
			});

		const size = new Setting(this.contentEl).setName("Size").setDesc(describeSize(this.draft.fontSize));
		size.addSlider((slider) =>
			slider
				.setLimits(10, 24, 1)
				.setValue(this.draft.fontSize ?? DEFAULT_SIZE)
				.onChange((value) => {
					this.set({ fontSize: value });
					size.setDesc(describeSize(value));
				}),
		);
		size.addExtraButton((button) =>
			button
				.setIcon("rotate-ccw")
				.setTooltip("Use the theme size")
				.onClick(() => {
					this.set({ fontSize: undefined });
					size.setDesc(describeSize(undefined));
				}),
		);
	}

	private buildFooter(): void {
		const footer = this.contentEl.createDiv({ cls: "treenav-appearance-footer" });

		new ButtonComponent(footer).setButtonText("Reset all").onClick(() => {
			this.draft = {};
			this.commit();
		});

		const buttons = footer.createDiv({ cls: "modal-button-container" });
		new ButtonComponent(buttons).setButtonText("Cancel").onClick(() => this.close());
		new ButtonComponent(buttons)
			.setButtonText("Apply")
			.setCta()
			.onClick(() => this.commit());
	}

	/** Records one change and shows it, so the preview is never behind the draft. */
	private set(patch: Partial<TreeNavStyle>): void {
		this.draft = { ...this.draft, ...patch };
		this.refreshPreview();
	}

	private refreshPreview(): void {
		const row = this.previewTitleEl.parentElement;
		if (row) {
			row.style.color = this.draft.color ?? "";
			row.style.fontFamily = resolveFontFamily(this.draft.fontFamily);
			row.style.fontWeight = this.draft.fontWeight ?? "";
			row.style.fontStyle = this.draft.fontStyle ?? "";
			row.style.fontSize = this.draft.fontSize ? `${this.draft.fontSize}px` : "";
		}

		this.styles.renderIcon(this.previewIconEl, this.file, this.draft.icon);

		this.swatchEls.forEach((el, index) =>
			el.toggleClass("treenav-is-current", SWATCHES[index].value === this.draft.color),
		);
		this.boldButton?.buttonEl.toggleClass("treenav-is-on", this.draft.fontWeight === "bold");
		this.italicButton?.buttonEl.toggleClass("treenav-is-on", this.draft.fontStyle === "italic");
	}

	private commit(): void {
		// Every property is sent, so one cleared here is cleared on the item too.
		this.onSubmit({
			icon: this.draft.icon,
			color: this.draft.color,
			fontFamily: this.draft.fontFamily,
			fontWeight: this.draft.fontWeight,
			fontStyle: this.draft.fontStyle,
			fontSize: this.draft.fontSize,
		});
		this.close();
	}
}

function describeSize(size: number | undefined): string {
	return size === undefined ? "Theme default" : `${size}px`;
}

/** The colour picker only understands hex, so theme variables map to nothing. */
function normalizeHex(color: string | undefined): string | undefined {
	return color && /^#[0-9a-f]{3,8}$/i.test(color) ? color : undefined;
}
