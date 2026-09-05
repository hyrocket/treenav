export interface InlineRenameHandlers {
	onCommit: (value: string) => void | Promise<void>;
	onCancel?: () => void;
	/** "stem" preselects everything before the last dot, for names with an extension. */
	selectRange?: "all" | "stem";
}

/**
 * Turns a title element into a text field in place. Enter commits, Escape
 * cancels, losing focus commits — matching the inline rename behaviour of the
 * built-in file explorer.
 */
export function startInlineRename(
	titleEl: HTMLElement,
	initialValue: string,
	handlers: InlineRenameHandlers,
): void {
	if (titleEl.hasClass("treenav-is-editing")) return;

	const originalText = titleEl.getText();
	titleEl.addClass("treenav-is-editing");
	titleEl.empty();

	const input = titleEl.createEl("input", { type: "text", cls: "treenav-rename-input" });
	input.value = initialValue;

	let settled = false;

	const restore = () => {
		titleEl.removeClass("treenav-is-editing");
		titleEl.empty();
		titleEl.setText(originalText);
	};

	const cancel = () => {
		if (settled) return;
		settled = true;
		restore();
		handlers.onCancel?.();
	};

	const commit = () => {
		if (settled) return;
		settled = true;
		const value = input.value;
		restore();
		void handlers.onCommit(value);
	};

	input.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			event.preventDefault();
			event.stopPropagation();
			commit();
		} else if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			cancel();
		}
	});
	// Keys must not reach the tree's own shortcut handling while editing.
	input.addEventListener("keyup", (event) => event.stopPropagation());
	input.addEventListener("blur", commit);
	input.addEventListener("click", (event) => event.stopPropagation());
	input.addEventListener("dblclick", (event) => event.stopPropagation());

	input.focus();
	const dot = initialValue.lastIndexOf(".");
	if (handlers.selectRange === "stem" && dot > 0) input.setSelectionRange(0, dot);
	else input.select();
}
