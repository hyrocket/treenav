import { App, TFile, getAllTags } from "obsidian";

/** What kind of file a search is willing to return. */
export type SearchKind = "any" | "notes" | "attachments";

/** How recently a file must have been modified. */
export type SearchAge = "any" | "today" | "week" | "month";

export interface SearchFilters {
	kind: SearchKind;
	/** A file extension without the dot, or `null` for any. */
	extension: string | null;
	age: SearchAge;
	/** A tag without the leading `#`, or `null` for any. */
	tag: string | null;
}

export const NO_FILTERS: SearchFilters = {
	kind: "any",
	extension: null,
	age: "any",
	tag: null,
};

export interface SearchResult {
	/** The best matches, at most as many as asked for. */
	files: TFile[];
	/** How many matched in total, which is usually more than were returned. */
	total: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const AGE_DAYS: Record<Exclude<SearchAge, "any">, number> = { today: 1, week: 7, month: 30 };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Finding a file by name, narrowed by what Obsidian already knows about it.
 *
 * Everything here comes from the vault and its metadata cache rather than from
 * TreeNav's own data: kind, extension, modification time and tags are facts
 * about the files, so a filter built on them means the same thing to everyone.
 * Icons and colours are not — they are chosen to look a certain way, and
 * filtering by them would read someone's decoration as a decision.
 *
 * Matching is a plain case-insensitive substring rather than a fuzzy match. The
 * job is to narrow a tree the user is already looking at, and fuzzy matching
 * answers a different question with a lot more noise.
 */
export class SearchService {
	constructor(private readonly app: App) {}

	/**
	 * Files matching `query` and `filters`, best first, capped at `limit`.
	 *
	 * Every file is examined on every keystroke. Measured at twenty thousand
	 * files that costs single-digit milliseconds, so there is no index to keep
	 * in step with the vault — which is the kind of thing that goes wrong.
	 */
	search(query: string, filters: SearchFilters, limit: number): SearchResult {
		const needle = query.trim().toLowerCase();
		const cutoff = ageCutoff(filters.age);
		const matches: { file: TFile; rank: number }[] = [];

		for (const file of this.app.vault.getFiles()) {
			if (!this.passes(file, filters, cutoff)) continue;
			const rank = needle ? rankOf(file, needle) : 0;
			if (rank < 0) continue;
			matches.push({ file, rank });
		}

		matches.sort(
			(a, b) => a.rank - b.rank || collator.compare(a.file.basename, b.file.basename),
		);

		return { files: matches.slice(0, limit).map((match) => match.file), total: matches.length };
	}

	/** Extensions that actually occur in this vault, for the filter to offer. */
	extensions(): string[] {
		const found = new Set<string>();
		for (const file of this.app.vault.getFiles()) {
			if (file.extension) found.add(file.extension);
		}
		return [...found].sort(collator.compare);
	}

	/**
	 * Tags that actually occur in this vault. Obsidian's public API has no call
	 * for this, so the cache is asked file by file; it is all in memory already.
	 */
	tags(): string[] {
		const found = new Set<string>();
		for (const file of this.app.vault.getFiles()) {
			for (const tag of this.tagsOf(file)) found.add(tag);
		}
		return [...found].sort(collator.compare);
	}

	/** Tags on one file, from both the body and the frontmatter, without `#`. */
	tagsOf(file: TFile): string[] {
		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache) return [];
		return (getAllTags(cache) ?? []).map((tag) => tag.replace(/^#/, ""));
	}

	private passes(file: TFile, filters: SearchFilters, cutoff: number): boolean {
		if (filters.kind === "notes" && file.extension !== "md") return false;
		if (filters.kind === "attachments" && file.extension === "md") return false;
		if (filters.extension && file.extension !== filters.extension) return false;
		if (cutoff && file.stat.mtime < cutoff) return false;

		if (filters.tag) {
			const wanted = filters.tag.toLowerCase();
			const tags = this.tagsOf(file).map((tag) => tag.toLowerCase());
			// A parent tag stands for everything under it: #project matches
			// #project/alpha, the way Obsidian's own tag pane treats them.
			if (!tags.some((tag) => tag === wanted || tag.startsWith(`${wanted}/`))) return false;
		}

		return true;
	}
}

/** 0 for a name that starts with it, 1 inside the name, 2 in the path, -1 for no match. */
function rankOf(file: TFile, needle: string): number {
	const name = file.basename.toLowerCase();
	if (name.startsWith(needle)) return 0;
	if (name.includes(needle)) return 1;
	if (file.path.toLowerCase().includes(needle)) return 2;
	return -1;
}

/** The oldest modification time still allowed, or 0 when any will do. */
function ageCutoff(age: SearchAge): number {
	if (age === "any") return 0;
	return Date.now() - AGE_DAYS[age] * DAY_MS;
}
