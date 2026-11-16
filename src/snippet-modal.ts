import { App, Modal, Notice, Setting } from "obsidian";
import type InlineAutocompletePlugin from "./main";
import { CustomSnippet } from "./types";

export class CreateSnippetModal extends Modal {
	private plugin: InlineAutocompletePlugin;
	private trigger = "";
	private expansion = "";
	private description = "";
	private onSaved?: () => void;

	constructor(
		app: App,
		plugin: InlineAutocompletePlugin,
		initialExpansion = "",
		onSaved?: () => void
	) {
		super(app);
		this.plugin = plugin;
		this.expansion = initialExpansion;
		this.onSaved = onSaved;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("iac-snippet-modal");

		this.setTitle("Add autocomplete snippet");

		new Setting(contentEl)
			.setName("Trigger prefix")
			.setDesc("Short word or prefix that triggers this snippet (e.g. callout, sig)")
			.addText((text) => {
				text
					.setPlaceholder("sig")
					.setValue(this.trigger)
					.onChange((val) => {
						this.trigger = val.trim();
					});
				window.setTimeout(() => text.inputEl.focus(), 40);
			});

		new Setting(contentEl)
			.setName("Description")
			.setDesc("Short label displayed in the autocomplete popup")
			.addText((text) =>
				text
					.setPlaceholder("Email signature")
					.setValue(this.description)
					.onChange((val) => {
						this.description = val.trim();
					})
			);

		const expGroup = contentEl.createDiv({ cls: "iac-modal-field" });
		expGroup.createEl("label", {
			text: "Expansion text",
			cls: "iac-modal-label setting-item-name",
			attr: { for: "iac-snippet-expansion" },
		});
		expGroup.createDiv({
			text: "Supports {{date}}, {{time}}, {{title}} and $CURSOR.",
			cls: "iac-modal-hint setting-item-description",
		});
		const textarea = expGroup.createEl("textarea", {
			cls: "iac-modal-textarea",
			attr: {
				id: "iac-snippet-expansion",
				rows: "5",
				placeholder: "Enter expanded text...",
			},
		});
		textarea.value = this.expansion;
		textarea.addEventListener("input", () => {
			this.expansion = textarea.value;
		});

		const footer = contentEl.createDiv({ cls: "iac-modal-footer" });
		const cancelBtn = footer.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => this.close());
		const saveBtn = footer.createEl("button", {
			text: "Save snippet",
			cls: "mod-cta",
		});
		saveBtn.addEventListener("click", () => void this.save());
	}

	private async save(): Promise<void> {
		if (!this.trigger || !this.expansion) {
			new Notice("Please provide both a trigger and expansion text.");
			return;
		}
		const snippet: CustomSnippet = {
			trigger: this.trigger,
			expansion: this.expansion,
			description: this.description || "Custom Snippet",
		};
		const existingIdx = this.plugin.settings.snippets.findIndex(
			(s) => s.trigger.toLowerCase() === this.trigger.toLowerCase()
		);
		if (existingIdx >= 0) {
			this.plugin.settings.snippets[existingIdx] = snippet;
		} else {
			this.plugin.settings.snippets.push(snippet);
		}
		await this.plugin.saveSettings();
		this.onSaved?.();
		new Notice(`Snippet "${this.trigger}" saved.`);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
