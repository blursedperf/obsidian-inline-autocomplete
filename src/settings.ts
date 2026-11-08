import { App, Notice, Platform, PluginSettingTab, Setting } from "obsidian";
import type InlineAutocompletePlugin from "./main";
import { CreateSnippetModal } from "./snippet-modal";

export class InlineAutocompleteSettingTab extends PluginSettingTab {
	private plugin: InlineAutocompletePlugin;

	constructor(app: App, plugin: InlineAutocompletePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Enable autocomplete")
			.setDesc("Master switch for inline ghost text and popup suggestions")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enabled)
					.onChange(async (val) => {
						this.plugin.settings.enabled = val;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Disable on mobile devices")
			.setDesc(
				"Turn off inline ghost text, popup suggestions, and background indexing when running on phones or tablets"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.disableOnMobile)
					.onChange(async (val) => {
						this.plugin.settings.disableOnMobile = val;
						await this.plugin.saveSettings();
						if (Platform.isMobile) {
							if (val) {
								this.plugin.engine.clear();
							} else {
								await this.plugin.loadLocalDictionary();
								await this.plugin.rebuildVaultIndex();
							}
							this.display();
						}
					})
			);

		new Setting(containerEl)
			.setName("Inline ghost text")
			.setDesc(
				"Show dimmed inline completion text at the cursor (Tab to accept all, Ctrl/Cmd+Right for next word, Alt+]/Alt+[ to cycle)"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableGhostText)
					.onChange(async (val) => {
						this.plugin.settings.enableGhostText = val;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Popup suggestion menu")
			.setDesc(
				"Display a floating dropdown list of matching completions below the cursor (Tab to confirm, Return to keep typed text)"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enablePopupSuggest)
					.onChange(async (val) => {
						this.plugin.settings.enablePopupSuggest = val;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Minimum prefix length")
			.setDesc("Minimum characters typed before word suggestions trigger (1–6)")
			.addSlider((slider) =>
				slider
					.setLimits(1, 6, 1)
					.setValue(this.plugin.settings.minPrefixLength)
					.setDynamicTooltip()
					.onChange(async (val) => {
						this.plugin.settings.minPrefixLength = val;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Maximum suggestions")
			.setDesc("Maximum number of completion candidates returned (3–20)")
			.addSlider((slider) =>
				slider
					.setLimits(3, 20, 1)
					.setValue(this.plugin.settings.maxSuggestions)
					.setDynamicTooltip()
					.onChange(async (val) => {
						this.plugin.settings.maxSuggestions = val;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Smart capitalization matching")
			.setDesc(
				"Automatically match TitleCase or UPPERCASE when you capitalize the prefix"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.matchCaseSmartly)
					.onChange(async (val) => {
						this.plugin.settings.matchCaseSmartly = val;
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("h2", { text: "Completion sources" });

		new Setting(containerEl)
			.setName("Index vault words")
			.setDesc(
				"Suggest words from your vault notes, weighted by frequency and current-file context"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.indexVaultWords)
					.onChange(async (val) => {
						this.plugin.settings.indexVaultWords = val;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Index multi-word phrases (N-grams)")
			.setDesc(
				"Suggest 2-word and 3-word phrases from your notes based on the preceding word"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.indexNgramPhrases)
					.onChange(async (val) => {
						this.plugin.settings.indexNgramPhrases = val;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Index note titles and headings")
			.setDesc("Suggest vault note titles and section headings")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.indexNoteTitlesAndHeadings)
					.onChange(async (val) => {
						this.plugin.settings.indexNoteTitlesAndHeadings = val;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Use local full dictionary fallback")
			.setDesc(
				"Load a full local wordlist (defaults to the bundled 50,000-word offline English dictionary)"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.useLocalFullDictionary)
					.onChange(async (val) => {
						this.plugin.settings.useLocalFullDictionary = val;
						await this.plugin.saveSettings();
						await this.plugin.loadLocalDictionary();
						this.display();
					})
			);

		new Setting(containerEl)
			.setName("Custom local dictionary file path")
			.setDesc(
				"Optional path to a custom .txt or .dic wordlist inside your vault. Leave empty to use the bundled dictionary."
			)
			.addText((text) =>
				text
					.setPlaceholder("my-dictionary.txt")
					.setValue(this.plugin.settings.localDictionaryPath)
					.onChange(async (val) => {
						this.plugin.settings.localDictionaryPath = val.trim();
						await this.plugin.saveSettings();
					})
			)
			.addButton((btn) =>
				btn.setButtonText("Reload dictionary").onClick(async () => {
					await this.plugin.loadLocalDictionary();
					const st = this.plugin.engine.getStats();
					this.display();
					new Notice(
						`Loaded ${st.dictionaryWords.toLocaleString()} dictionary words from ${st.dictionarySource}`
					);
				})
			);

		new Setting(containerEl)
			.setName("Include built-in technical vocabulary")
			.setDesc("Include high-frequency technical, scientific, and knowledge management terms")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.includeBuiltInDictionary)
					.onChange(async (val) => {
						this.plugin.settings.includeBuiltInDictionary = val;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Ignore YAML frontmatter")
			.setDesc("Suppress autocomplete when typing inside YAML frontmatter")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.ignoreFrontmatter)
					.onChange(async (val) => {
						this.plugin.settings.ignoreFrontmatter = val;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Ignore fenced code blocks")
			.setDesc("Suppress autocomplete when typing inside ``` code blocks")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.ignoreCodeBlocks)
					.onChange(async (val) => {
						this.plugin.settings.ignoreCodeBlocks = val;
						await this.plugin.saveSettings();
					})
			);

		// Custom Dictionary Words
		new Setting(containerEl)
			.setName("Custom dictionary words")
			.setDesc("Comma- or newline-separated list of custom terms to always suggest")
			.addTextArea((area) => {
				area
					.setPlaceholder("Zettelkasten, PKM, Spaced Repetition")
					.setValue(this.plugin.settings.customWords.join(", "))
					.onChange(async (val) => {
						this.plugin.settings.customWords = val
							.split(/[,\n]+/)
							.map((s) => s.trim())
							.filter(Boolean);
						await this.plugin.saveSettings();
					});
				area.inputEl.rows = 3;
				area.inputEl.addClass("iac-custom-words-input");
			});

		// Snippets Section
		containerEl.createEl("h2", { text: "Custom snippets" });

		new Setting(containerEl)
			.setName("Add new snippet")
			.setDesc(
				"Snippets support {{date}}, {{time}}, {{title}}, and $CURSOR placement"
			)
			.addButton((btn) =>
				btn
					.setButtonText("New snippet")
					.setCta()
					.onClick(() => {
						new CreateSnippetModal(this.app, this.plugin, "", () =>
							this.display()
						).open();
					})
			);

		for (let i = 0; i < this.plugin.settings.snippets.length; i++) {
			const snip = this.plugin.settings.snippets[i];
			new Setting(containerEl)
				.setName(`${snip.trigger} — ${snip.description}`)
				.setDesc(snip.expansion.replace(/\n/g, " ↵ "))
				.addExtraButton((btn) =>
					btn
						.setIcon("trash")
						.setTooltip("Delete snippet")
						.onClick(async () => {
							this.plugin.settings.snippets.splice(i, 1);
							await this.plugin.saveSettings();
							this.display();
						})
				);
		}

		// Index Status & Rebuild
		containerEl.createEl("h2", { text: "Vault and dictionary index" });
		const stats = this.plugin.engine.getStats();
		new Setting(containerEl)
			.setName("Indexed vault vocabulary")
			.setDesc(
				`${stats.indexedFiles} files · ${stats.uniqueWords.toLocaleString()} vault words · ${stats.uniquePhrases.toLocaleString()} phrases · ${stats.noteTitlesAndHeadings} titles/headings`
			)
			.addButton((btn) =>
				btn.setButtonText("Rebuild vault index").onClick(async () => {
					await this.plugin.rebuildVaultIndex();
					this.display();
					new Notice("Vault autocomplete index rebuilt.");
				})
			);

		new Setting(containerEl)
			.setName("Active fallback dictionary")
			.setDesc(
				`${stats.dictionaryWords.toLocaleString()} words indexed into 2-char prefix buckets — Source: ${stats.dictionarySource}`
			);
	}
}
