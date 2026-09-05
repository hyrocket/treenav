import { App, FuzzyMatch, FuzzySuggestModal, getIconIds, setIcon } from "obsidian";

interface IconChoice {
	/** `null` is the "no icon" entry. */
	id: string | null;
	label: string;
}

/**
 * Picks one of the icons Obsidian already ships (Lucide plus anything other
 * plugins registered), so TreeNav never bundles its own icon set.
 */
export class IconPickerModal extends FuzzySuggestModal<IconChoice> {
	private readonly choices: IconChoice[];

	constructor(
		app: App,
		private readonly currentIcon: string | undefined,
		private readonly onChoose: (icon: string | undefined) => void,
	) {
		super(app);
		this.setPlaceholder("Search icons…");

		this.choices = [
			{ id: null, label: "No icon" },
			...getIconIds().map((id) => ({ id, label: prettify(id) })),
		];
	}

	getItems(): IconChoice[] {
		return this.choices;
	}

	getItemText(item: IconChoice): string {
		return item.label;
	}

	renderSuggestion(match: FuzzyMatch<IconChoice>, el: HTMLElement): void {
		const { id, label } = match.item;
		el.addClass("treenav-icon-suggestion");

		const iconEl = el.createDiv({ cls: "treenav-icon-suggestion-icon" });
		if (id) setIcon(iconEl, id);

		el.createDiv({ cls: "treenav-icon-suggestion-label", text: label });
		if (id && id === this.currentIcon) {
			el.createDiv({ cls: "treenav-icon-suggestion-current", text: "current" });
		}
	}

	onChooseItem(item: IconChoice): void {
		this.onChoose(item.id ?? undefined);
	}
}

/** `lucide-folder-kanban` -> `folder kanban`, so search matches plain words. */
function prettify(id: string): string {
	return id.replace(/^lucide-/, "").replace(/-/g, " ");
}
