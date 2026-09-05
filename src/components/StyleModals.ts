import { App, Modal, Setting } from "obsidian";
import { FontStyle, FontWeight, TreeNavStyle } from "../types";

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

export class FontModal extends Modal {
	private draft: Pick<TreeNavStyle, "fontWeight" | "fontStyle" | "fontSize">;

	constructor(
		app: App,
		private readonly itemName: string,
		current: TreeNavStyle | undefined,
		private readonly onSubmit: (
			font: Pick<TreeNavStyle, "fontWeight" | "fontStyle" | "fontSize">,
		) => void,
	) {
		super(app);
		this.draft = {
			fontWeight: current?.fontWeight,
			fontStyle: current?.fontStyle,
			fontSize: current?.fontSize,
		};
	}

	onOpen(): void {
		this.titleEl.setText(`Font — ${this.itemName}`);

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

	onClose(): void {
		this.contentEl.empty();
	}

	private commit(): void {
		this.onSubmit(this.draft);
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
