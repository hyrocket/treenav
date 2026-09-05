import { App, Modal, Setting } from "obsidian";

export type FlattenDecision = "flatten" | "keep";

/**
 * Asked when a folder TreeNav created by nesting is down to its own folder
 * note. Trashing a folder is hard to take back, so the choice is the user's.
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
			text: `"${this.folderName}" has nothing left inside it but its own note. TreeNav created this folder when you nested something under that note.`,
		});
		this.contentEl.createEl("p", {
			cls: "treenav-prompt-detail",
			text: "Turning it back moves the note out and sends the empty folder to the trash. Keeping it leaves everything as it is.",
		});

		new Setting(this.contentEl)
			.setName("Don't ask again")
			.setDesc("Remember this choice in settings. You can change it there later.")
			.addToggle((toggle) => toggle.setValue(this.remember).onChange((value) => (this.remember = value)));

		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText("Keep folder").onClick(() => this.finish("keep")))
			.addButton((button) =>
				button
					.setButtonText("Turn back into a note")
					.setCta()
					.onClick(() => this.finish("flatten")),
			);
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
