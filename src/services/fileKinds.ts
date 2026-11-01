import { App, TFile } from "obsidian";

/** Formats Obsidian always opens itself, whatever the plugins registered. */
const CORE_DOCUMENTS = new Set(["md", "canvas", "base"]);

/**
 * Formats Obsidian can display but that are still attachments: what a note
 * embeds rather than what someone writes in.
 */
const MEDIA = new Set([
	"pdf",
	"avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp",
	"3gp", "flac", "m4a", "mp3", "oga", "ogg", "opus", "wav",
	"mkv", "mov", "mp4", "ogv", "webm",
]);

/** Not in the public typings; the core file explorer asks it the same thing. */
interface ViewRegistry {
	isExtensionRegistered(extension: string): boolean;
}

/**
 * A file someone writes in — a note, a canvas, a base, or any format a plugin
 * opens as a view of its own. Documents stay listed when attachments are
 * hidden, as they do in the core explorer.
 *
 * The core explorer lists every extension a view is registered for. Asking the
 * registry rather than keeping a list is what makes a plugin's own format show
 * up; a fixed list once hid every canvas.
 */
export function isDocument(app: App, file: TFile): boolean {
	const extension = file.extension.toLowerCase();
	if (CORE_DOCUMENTS.has(extension)) return true;
	if (MEDIA.has(extension)) return false;
	const registry = (app as App & { viewRegistry?: ViewRegistry }).viewRegistry;
	return registry?.isExtensionRegistered(extension) ?? false;
}
