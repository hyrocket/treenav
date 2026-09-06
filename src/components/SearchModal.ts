import { App, SuggestModal, TFile } from "obsidian";
import {
	NO_FILTERS,
	SearchAge,
	SearchFilters,
	SearchKind,
	SearchService,
} from "../services/SearchService";
import { StyleService } from "../services/StyleService";

/** How many rows are drawn. A vault can match thousands; a list cannot show them. */
const LIMIT = 100;

const KINDS: Record<SearchKind, string> = {
	any: "Anything",
	notes: "Notes",
	attachments: "Attachments",
};

const AGES: Record<SearchAge, string> = {
	any: "Any time",
	today: "Today",
	yesterday: "Yesterday",
	week: "Past week",
	month: "Past month",
};

/**
 * Find a file and go to it in the tree.
 *
 * Obsidian's own switcher opens a note; this one also puts the tree on it, with
 * every folder along the way opened. That is the part a navigation plugin owes
 * the user, and it is why the entry point is here rather than left to the core.
 *
 * The filters sit under the input rather than in the sidebar: at three hundred
 * pixels the tree would have no room left, and a filtered list is something you
 * come to, use, and leave.
 *
 * A folder is not offered on its own. Nearly every folder worth finding has a
 * folder note, and choosing that note lands on the folder's row anyway.
 */
export class SearchModal extends SuggestModal<TFile> {
	private filters: SearchFilters = { ...NO_FILTERS };
	private countEl: HTMLElement | null = null;
	private total = 0;

	constructor(
		app: App,
		private readonly search: SearchService,
		private readonly styles: StyleService,
		private readonly onChoose: (file: TFile) => void,
	) {
		super(app);
		this.limit = LIMIT;
		this.setPlaceholder("Find a file in the tree…");
		this.emptyStateText = "Nothing matches.";
		this.modalEl.addClass("treenav-search-modal");
		this.setInstructions([
			{ command: "↑↓", purpose: "to move" },
			{ command: "↵", purpose: "to open and reveal" },
			{ command: "esc", purpose: "to close" },
		]);
	}

	onOpen(): void {
		super.onOpen();
		this.buildFilters();
		this.buildCount();
	}

	getSuggestions(query: string): TFile[] {
		const result = this.search.search(query, this.filters, this.limit);
		this.total = result.total;
		this.updateCount();
		return result.files;
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.addClass("treenav-search-row");

		const iconEl = el.createDiv({ cls: "treenav-item-icon" });
		this.styles.applyToIcon(iconEl, file);

		el.createDiv({ cls: "treenav-search-name", text: file.basename });
		el.createDiv({
			cls: "treenav-search-path",
			text: file.parent && !file.parent.isRoot() ? file.parent.path : "/",
		});
	}

	onChooseSuggestion(file: TFile): void {
		this.onChoose(file);
	}

	/**
	 * The filter row, built into the modal between the input and the results.
	 *
	 * Changing one re-runs the search by way of the input event, which is what
	 * the suggester itself listens to — there is no public call to ask it for a
	 * refresh, and pretending the user typed is the honest version of that.
	 */
	private buildFilters(): void {
		const row = this.modalEl.createDiv({ cls: "treenav-search-filters" });
		this.modalEl.insertBefore(row, this.resultContainerEl);

		this.addSelect(row, KINDS, "any", (value) => {
			this.filters.kind = value as SearchKind;
		});

		const extensions: Record<string, string> = { "": "Any type" };
		for (const extension of this.search.extensions()) extensions[extension] = `.${extension}`;
		this.addSelect(row, extensions, "", (value) => {
			this.filters.extension = value || null;
		});

		this.addSelect(row, AGES, "any", (value) => {
			this.filters.age = value as SearchAge;
		});

		const tags: Record<string, string> = { "": "Any tag" };
		for (const tag of this.search.tags()) tags[tag] = `#${tag}`;
		this.addSelect(row, tags, "", (value) => {
			this.filters.tag = value || null;
		});
	}

	private addSelect(
		parent: HTMLElement,
		options: Record<string, string>,
		selected: string,
		onChange: (value: string) => void,
	): void {
		const select = parent.createEl("select", { cls: "dropdown treenav-search-filter" });
		for (const [value, label] of Object.entries(options)) {
			const option = select.createEl("option", { text: label });
			option.value = value;
		}
		select.value = selected;

		select.addEventListener("change", () => {
			onChange(select.value);
			// Runs the search again and puts the cursor back where typing goes.
			this.inputEl.dispatchEvent(new Event("input"));
			this.inputEl.focus();
		});
	}

	private buildCount(): void {
		this.countEl = this.modalEl.createDiv({ cls: "treenav-search-count" });
		this.updateCount();
	}

	private updateCount(): void {
		if (!this.countEl) return;
		if (this.total === 0) {
			this.countEl.setText("");
			return;
		}
		this.countEl.setText(
			this.total > this.limit
				? `showing ${this.limit} of ${this.total}`
				: `${this.total} ${this.total === 1 ? "match" : "matches"}`,
		);
	}
}
