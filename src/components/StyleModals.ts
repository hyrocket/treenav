import { App, DropdownComponent, Modal, Setting, TextComponent } from "obsidian";
import { FONT_TOKENS, FontStyle, FontToken, FontWeight, TreeNavStyle } from "../types";

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

export class ColorModal extends Modal {
	constructor(
		app: App,
		private readonly itemName: string,
		private readonly current: string | undefined,
		private readonly onSubmit: (color: string | undefined) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(`Color — ${this.itemName}`);

		const grid = this.contentEl.createDiv({ cls: "treenav-swatch-grid" });
		for (const swatch of SWATCHES) {
			const el = grid.createDiv({ cls: "treenav-swatch" });
			el.setAttribute("aria-label", swatch.name);
			el.style.backgroundColor = swatch.value;
			el.toggleClass("treenav-is-current", swatch.value === this.current);
			el.addEventListener("click", () => this.commit(swatch.value));
		}

		new Setting(this.contentEl)
			.setName("Custom color")
			.setDesc("A fixed color, used as-is in both light and dark themes.")
			.addColorPicker((picker) =>
				picker
					.setValue(normalizeHex(this.current) ?? "#888888")
					.onChange((value) => this.commit(value)),
			);

		new Setting(this.contentEl).addButton((button) =>
			button.setButtonText("Clear color").onClick(() => this.commit(undefined)),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private commit(color: string | undefined): void {
		this.onSubmit(color);
		this.close();
	}
}

type FontDraft = Pick<TreeNavStyle, "fontFamily" | "fontWeight" | "fontStyle" | "fontSize">;

export class FontModal extends Modal {
	private draft: FontDraft;

	constructor(
		app: App,
		private readonly itemName: string,
		current: TreeNavStyle | undefined,
		private readonly onSubmit: (font: FontDraft) => void,
	) {
		super(app);
		this.draft = {
			fontFamily: current?.fontFamily,
			fontWeight: current?.fontWeight,
			fontStyle: current?.fontStyle,
			fontSize: current?.fontSize,
		};
	}

	onOpen(): void {
		this.titleEl.setText(`Font — ${this.itemName}`);

		this.buildTypeface();

		new Setting(this.contentEl).setName("Weight").addDropdown((dropdown) =>
			dropdown
				.addOptions({ "": "Theme default", normal: "Normal", bold: "Bold" })
				.setValue(this.draft.fontWeight ?? "")
				.onChange((value) => {
					this.draft.fontWeight = (value || undefined) as FontWeight | undefined;
				}),
		);

		new Setting(this.contentEl).setName("Style").addDropdown((dropdown) =>
			dropdown
				.addOptions({ "": "Theme default", normal: "Normal", italic: "Italic" })
				.setValue(this.draft.fontStyle ?? "")
				.onChange((value) => {
					this.draft.fontStyle = (value || undefined) as FontStyle | undefined;
				}),
		);

		const sizeSetting = new Setting(this.contentEl)
			.setName("Size")
			.setDesc(describeSize(this.draft.fontSize));

		sizeSetting.addSlider((slider) =>
			slider
				.setLimits(10, 24, 1)
				.setValue(this.draft.fontSize ?? 13)
				.onChange((value) => {
					this.draft.fontSize = value;
					sizeSetting.setDesc(describeSize(value));
				}),
		);
		sizeSetting.addExtraButton((button) =>
			button
				.setIcon("rotate-ccw")
				.setTooltip("Use the theme size")
				.onClick(() => {
					this.draft.fontSize = undefined;
					sizeSetting.setDesc(describeSize(undefined));
				}),
		);

		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText("Clear font").onClick(() => {
					this.draft = {};
					this.commit();
				}),
			)
			.addButton((button) => button.setButtonText("Apply").setCta().onClick(() => this.commit()));
	}

	/**
	 * A theme token or a font name, never both.
	 *
	 * Tokens follow the theme, so they resolve to something sensible on every
	 * platform. A typed name is exact but platform-bound — Windows and macOS
	 * ship different fonts — which is why the field takes a comma-separated
	 * stack and says so. Obsidian exposes no way to list the fonts a device
	 * has, so this has to be typed rather than picked.
	 */
	private buildTypeface(): void {
		const stored = this.draft.fontFamily;
		const token = isFontToken(stored) ? stored : "";
		const custom = stored && !isFontToken(stored) ? stored : "";

		let dropdown: DropdownComponent | null = null;
		let text: TextComponent | null = null;

		new Setting(this.contentEl)
			.setName("Typeface")
			.setDesc("Follows the fonts your theme defines, so it travels between devices.")
			.addDropdown((component) => {
				dropdown = component;
				component
					.addOptions({
						"": "Theme default",
						interface: "Interface",
						text: "Text",
						monospace: "Monospace",
					})
					.setValue(token)
					.onChange((value) => {
						text?.setValue("");
						this.draft.fontFamily = value || undefined;
					});
			});

		new Setting(this.contentEl)
			.setName("Or a specific font")
			.setDesc(
				"Windows and macOS ship different fonts, so list fallbacks separated by commas — the first one installed wins.",
			)
			.addText((component) => {
				text = component;
				component
					.setPlaceholder("Pretendard, Malgun Gothic, sans-serif")
					.setValue(custom)
					.onChange((value) => {
						const trimmed = value.trim();
						if (trimmed) dropdown?.setValue("");
						this.draft.fontFamily = trimmed || undefined;
					});
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private commit(): void {
		this.onSubmit(this.draft);
		this.close();
	}
}

function isFontToken(value: string | undefined): value is FontToken {
	return !!value && (FONT_TOKENS as readonly string[]).includes(value);
}

function describeSize(size: number | undefined): string {
	return size === undefined ? "Theme default" : `${size}px`;
}

/** The colour picker only understands hex, so theme variables map to nothing. */
function normalizeHex(color: string | undefined): string | undefined {
	return color && /^#[0-9a-f]{3,8}$/i.test(color) ? color : undefined;
}
