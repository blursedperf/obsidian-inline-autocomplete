import {
	App,
	Notice,
	Platform,
	PluginSettingTab,
	SettingDefinitionItem,
} from "obsidian";
import type InlineAutocompletePlugin from "./main";
import { CreateSnippetModal } from "./snippet-modal";
import type { AutocompleteSettings } from "./types";

type SettingKey = keyof AutocompleteSettings;

export class InlineAutocompleteSettingTab extends PluginSettingTab {
	private plugin: InlineAutocompletePlugin;

	constructor(app: App, plugin: InlineAutocompletePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getControlValue(key: string): unknown {
		if (key === "customWords") {
			return this.plugin.settings.customWords.join(", ");
		}
		return this.plugin.settings[key as SettingKey];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const settings = this.plugin.settings as unknown as Record<string, unknown>;

		if (key === "customWords") {
			settings.customWords = String(value)
				.split(/[,\n]+/)
				.map((s) => s.trim())
				.filter(Boolean);
		} else if (key === "localDictionaryPath") {
			settings.localDictionaryPath = String(value).trim();
		} else {
			settings[key] = value;
		}
		await this.plugin.saveSettings();

		// Side effects for settings that change what is loaded/indexed
		if (key === "disableOnMobile" && Platform.isMobile) {
			if (value) {
				this.plugin.engine.clear();
			} else {
				await this.plugin.loadLocalDictionary();
				await this.plugin.rebuildVaultIndex();
			}
			this.update();
		} else if (
			key === "indexVaultWords" ||
			key === "indexNgramPhrases" ||
			key === "indexNoteTitlesAndHeadings"
		) {
			await this.plugin.rebuildVaultIndex();
			this.update();
		} else if (key === "useLocalFullDictionary") {
			await this.plugin.loadLocalDictionary();
			this.update();
		}
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const stats = this.plugin.engine.getStats();

		return [
			{
				type: "group",
				heading: "General",
				items: [
					{
						name: "Enable autocomplete",
						desc: "Master switch for inline ghost text and popup suggestions",
						control: { type: "toggle", key: "enabled" },
					},
					{
						name: "Disable on mobile devices",
						desc: "Turn off inline ghost text, popup suggestions, and background indexing when running on phones or tablets",
						control: { type: "toggle", key: "disableOnMobile" },
					},
					{
						name: "Inline ghost text",
						desc: "Show dimmed inline completion text at the cursor (Tab to accept all, Ctrl/Cmd+Right for next word, Alt+]/Alt+[ to cycle)",
						control: { type: "toggle", key: "enableGhostText" },
					},
					{
						name: "Popup suggestion menu",
						desc: "Display a floating dropdown list of matching completions below the cursor (Tab to confirm, Return to keep typed text)",
						control: { type: "toggle", key: "enablePopupSuggest" },
					},
					{
						name: "Minimum prefix length",
						desc: "Minimum characters typed before word suggestions trigger (1–6)",
						control: {
							type: "slider",
							key: "minPrefixLength",
							min: 1,
							max: 6,
							step: 1,
						},
					},
					{
						name: "Maximum suggestions",
						desc: "Maximum number of completion candidates returned (3–20)",
						control: {
							type: "slider",
							key: "maxSuggestions",
							min: 3,
							max: 20,
							step: 1,
						},
					},
					{
						name: "Smart capitalization matching",
						desc: "Automatically match TitleCase or UPPERCASE when you capitalize the prefix",
						control: { type: "toggle", key: "matchCaseSmartly" },
					},
				],
			},
			{
				type: "group",
				heading: "Completion sources",
				items: [
					{
						name: "Index vault words",
						desc: "Suggest words from your vault notes, weighted by frequency and current-file context",
						control: { type: "toggle", key: "indexVaultWords" },
					},
					{
						name: "Index multi-word phrases (N-grams)",
						desc: "Suggest 2-word and 3-word phrases from your notes based on the preceding word",
						control: { type: "toggle", key: "indexNgramPhrases" },
					},
					{
						name: "Index note titles and headings",
						desc: "Suggest vault note titles and section headings",
						control: { type: "toggle", key: "indexNoteTitlesAndHeadings" },
					},
					{
						name: "Use local full dictionary fallback",
						desc: "Load a full local wordlist (defaults to the bundled 50,000-word offline English dictionary)",
						control: { type: "toggle", key: "useLocalFullDictionary" },
					},
					{
						name: "Custom local dictionary file",
						desc: "Optional .txt or .dic wordlist inside your vault. Leave empty to use the bundled dictionary.",
						control: {
							type: "file",
							key: "localDictionaryPath",
							placeholder: "my-dictionary.txt",
							filter: (file) =>
								file.extension === "txt" || file.extension === "dic",
						},
					},
					{
						name: "Reload dictionary",
						desc: `Currently loaded: ${stats.dictionaryWords.toLocaleString()} words from ${stats.dictionarySource}`,
						action: () => void this.reloadDictionary(),
					},
					{
						name: "Include built-in technical vocabulary",
						desc: "Include high-frequency technical, scientific, and knowledge management terms",
						control: { type: "toggle", key: "includeBuiltInDictionary" },
					},
					{
						name: "Ignore YAML frontmatter",
						desc: "Suppress autocomplete when typing inside YAML frontmatter",
						control: { type: "toggle", key: "ignoreFrontmatter" },
					},
					{
						name: "Ignore fenced code blocks",
						desc: "Suppress autocomplete when typing inside ``` code blocks",
						control: { type: "toggle", key: "ignoreCodeBlocks" },
					},
					{
						name: "Custom dictionary words",
						desc: "Comma- or newline-separated list of custom terms to always suggest",
						control: {
							type: "textarea",
							key: "customWords",
							placeholder: "Zettelkasten, PKM, Spaced Repetition",
							rows: 3,
						},
					},
				],
			},
			{
				type: "list",
				heading: "Custom snippets",
				emptyState:
					"No snippets yet. Snippets support {{date}}, {{time}}, {{title}}, and $CURSOR placement.",
				addItem: {
					name: "New snippet",
					action: () => {
						new CreateSnippetModal(this.app, this.plugin, "", () =>
							this.update()
						).open();
					},
				},
				onDelete: (index) => void this.deleteSnippet(index),
				items: this.plugin.settings.snippets.map((snip) => ({
					name: `${snip.trigger} — ${snip.description}`,
					desc: snip.expansion.replace(/\n/g, " ↵ "),
				})),
			},
			{
				type: "group",
				heading: "Vault and dictionary index",
				items: [
					{
						name: "Rebuild vault index",
						desc: `${stats.indexedFiles} files · ${stats.uniqueWords.toLocaleString()} vault words · ${stats.uniquePhrases.toLocaleString()} phrases · ${stats.noteTitlesAndHeadings} titles/headings`,
						action: () => void this.rebuildIndex(),
					},
				],
			},
		];
	}

	private async reloadDictionary(): Promise<void> {
		await this.plugin.loadLocalDictionary();
		const st = this.plugin.engine.getStats();
		this.update();
		new Notice(
			`Loaded ${st.dictionaryWords.toLocaleString()} dictionary words from ${st.dictionarySource}`
		);
	}

	private async rebuildIndex(): Promise<void> {
		await this.plugin.rebuildVaultIndex();
		this.update();
		new Notice("Vault autocomplete index rebuilt.");
	}

	private async deleteSnippet(index: number): Promise<void> {
		this.plugin.settings.snippets.splice(index, 1);
		await this.plugin.saveSettings();
		this.update();
	}
}
