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

function isRegistered(app: App, extension: string): boolean {
	const registry = (app as App & { viewRegistry?: ViewRegistry }).viewRegistry;
	return registry?.isExtensionRegistered(extension) ?? false;
}

/**
 * Whether the core file explorer would list this file: anything Obsidian or a
 * plugin can open — notes, canvases, images, PDFs, audio, video — and every
 * file at all when "Detect all file extensions" is on. Hiding images by
 * default once left an attachment folder looking empty.
 */
export function isSupportedFile(app: App, file: TFile): boolean {
	const vault = app.vault as typeof app.vault & { getConfig?(key: string): unknown };
	if (vault.getConfig?.("showUnsupportedFiles")) return true;
	const extension = file.extension.toLowerCase();
	return CORE_DOCUMENTS.has(extension) || MEDIA.has(extension) || isRegistered(app, extension);
}

/**
 * A file someone writes in — a note, a canvas, a base, or any format a plugin
 * opens as a view of its own, as opposed to media a note embeds. Search's
 * Notes / Attachments filter splits files by it.
 *
 * Asking the registry rather than keeping a list is what makes a plugin's own
 * format count; a fixed list once hid every canvas.
 */
export function isDocument(app: App, file: TFile): boolean {
	const extension = file.extension.toLowerCase();
	if (CORE_DOCUMENTS.has(extension)) return true;
	if (MEDIA.has(extension)) return false;
	return isRegistered(app, extension);
}
