import { App, Modal } from "obsidian";

export type FlattenDecision = "flatten" | "keep";

/**
 * Asked when a folder TreeNav created by nesting is down to its own folder
 * note. Trashing a folder is hard to take back, so the choice is the user's.
 *
 * "Remember my choice" sits on the button row rather than in a settings-style
 * row of its own: it modifies the button the user is about to press, and
 * giving it equal weight to the decision reads like a separate question.
 *
 * Closing the dialog any other way keeps the folder — the outcome that changes
 * nothing.
 */
export class FlattenPromptModal extends Modal {
	private remember = false;
	private settled = false;

	constructor(
		app: App,
		private readonly folderName: string,
		private readonly onDone: (decision: FlattenDecision, remember: boolean) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(`Turn "${this.folderName}" back into a note?`);

		this.contentEl.createEl("p", {
			text: `Nothing is left inside "${this.folderName}" but its own note. Turning it back moves the note out and sends the empty folder to the trash.`,
		});

		const footer = this.contentEl.createDiv({ cls: "treenav-prompt-footer" });

		const rememberEl = footer.createEl("label", { cls: "treenav-prompt-remember" });
		const checkbox = rememberEl.createEl("input", { type: "checkbox" });
		checkbox.addEventListener("change", () => (this.remember = checkbox.checked));
		rememberEl.createSpan({ text: "Remember my choice" });

		const buttons = footer.createDiv({ cls: "modal-button-container" });

		const keepEl = buttons.createEl("button", { text: "Keep folder" });
		keepEl.addEventListener("click", () => this.finish("keep"));

		const flattenEl = buttons.createEl("button", {
			cls: "mod-cta",
			text: "Turn back into a note",
		});
		flattenEl.addEventListener("click", () => this.finish("flatten"));
		flattenEl.focus();
	}

	onClose(): void {
		this.contentEl.empty();
		if (this.settled) return;
		// Dismissed without choosing: leave the vault untouched.
		this.settled = true;
		this.onDone("keep", false);
	}

	private finish(decision: FlattenDecision): void {
		this.settled = true;
		this.close();
		this.onDone(decision, this.remember);
	}
}
