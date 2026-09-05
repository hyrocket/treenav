import { App, FuzzyMatch, FuzzySuggestModal, getIconIds, setIcon } from "obsidian";
import { isEmoji, withEmojiPresentation } from "../services/StyleService";

interface IconChoice {
	/** A Lucide icon id, an emoji, or `null` for the "no icon" entry. */
	id: string | null;
	label: string;
}

/**
 * A handful of emoji worth searching by name. Anything else can be typed or
 * pasted straight into the search box — there is no point shipping the whole
 * Unicode emoji index to make that work.
 */
const EMOJI: [string, string][] = [
	["📁", "folder"],
	["📂", "folder open"],
	["🗂️", "folder dividers card index"],
	["🗄️", "cabinet archive"],
	["📄", "page document note"],
	["📝", "memo note writing"],
	["📌", "pin"],
	["⭐", "star favourite"],
	["🔥", "fire hot urgent"],
	["✅", "check done complete"],
	["❗", "important exclamation"],
	["❓", "question"],
	["💡", "idea lightbulb"],
	["🎯", "target goal"],
	["🚀", "rocket launch ship"],
	["🧪", "experiment lab test"],
	["🔧", "tool wrench fix"],
	["⚙️", "settings gear config"],
	["📅", "calendar date"],
	["⏰", "alarm time"],
	["💰", "money finance"],
	["📊", "chart data report"],
	["📈", "growth chart up"],
	["🏢", "company office building"],
	["👥", "people team meeting"],
	["🤝", "handshake deal partner"],
	["✉️", "mail email"],
	["🔒", "lock private secure"],
	["🗑️", "trash bin archive"],
	["📦", "box package archive"],
	["🎨", "design art"],
	["🧠", "brain think"],
	["📚", "books reading library"],
	["🏠", "home house"],
	["🌍", "world global"],
	["🔴", "red circle"],
	["🟠", "orange circle"],
	["🟡", "yellow circle"],
	["🟢", "green circle"],
	["🔵", "blue circle"],
	["🟣", "purple circle"],
	["⚫", "black circle"],
	["⚪", "white circle"],
];

/**
 * Picks an icon: any icon Obsidian already has registered (Lucide, plus
 * whatever other plugins added), or an emoji.
 *
 * Lucide icons follow the theme's colour and look the same on every platform;
 * emoji bring their own colour and a far wider vocabulary but are drawn by the
 * operating system, so they differ between machines. Both are worth having.
 */
export class IconPickerModal extends FuzzySuggestModal<IconChoice> {
	private readonly choices: IconChoice[];

	constructor(
		app: App,
		private readonly currentIcon: string | undefined,
		private readonly onChoose: (icon: string | undefined) => void,
	) {
		super(app);
		this.setPlaceholder("Search icons, or type an emoji…");

		this.choices = [
			{ id: null, label: "No icon" },
			...EMOJI.map(([emoji, name]) => ({ id: emoji, label: name })),
			...getIconIds().map((id) => ({ id, label: prettify(id) })),
		];
	}

	getItems(): IconChoice[] {
		return this.choices;
	}

	getItemText(item: IconChoice): string {
		return item.label;
	}

	/** An emoji typed into the box is offered directly, named or not. */
	getSuggestions(query: string): FuzzyMatch<IconChoice>[] {
		const matches = super.getSuggestions(query);
		const typed = query.trim();
		if (!typed || !isEmoji(typed)) return matches;

		return [
			{ item: { id: typed, label: `Use ${typed}` }, match: { score: 0, matches: [] } },
			...matches,
		];
	}

	renderSuggestion(match: FuzzyMatch<IconChoice>, el: HTMLElement): void {
		const { id, label } = match.item;
		el.addClass("treenav-icon-suggestion");

		const iconEl = el.createDiv({ cls: "treenav-icon-suggestion-icon" });
		if (id && isEmoji(id)) iconEl.setText(id);
		else if (id) setIcon(iconEl, id);

		el.createDiv({ cls: "treenav-icon-suggestion-label", text: label });
		if (id && id === this.currentIcon) {
			el.createDiv({ cls: "treenav-icon-suggestion-current", text: "current" });
		}
	}

	onChooseItem(item: IconChoice): void {
		if (!item.id) {
			this.onChoose(undefined);
			return;
		}
		this.onChoose(isEmoji(item.id) ? withEmojiPresentation(item.id) : item.id);
	}
}

/** `lucide-folder-kanban` -> `folder kanban`, so search matches plain words. */
function prettify(id: string): string {
	return id.replace(/^lucide-/, "").replace(/-/g, " ");
}
