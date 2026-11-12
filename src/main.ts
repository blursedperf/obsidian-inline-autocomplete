import {
	Editor,
	MarkdownView,
	Notice,
	Platform,
	Plugin,
	TFile,
	debounce,
} from "obsidian";
import { EditorView } from "@codemirror/view";
import { AutocompleteSettings, DEFAULT_SETTINGS } from "./types";
import { CompletionEngine } from "./indexer";
import {
	acceptFullGhostCompletion,
	acceptNextWordGhostCompletion,
	createGhostTextExtension,
	cycleActiveGhostCompletion,
	dismissActiveGhostCompletion,
} from "./ghost-text";
import { InlinePopupSuggest } from "./popup-suggest";
import { CreateSnippetModal } from "./snippet-modal";
import { InlineAutocompleteSettingTab } from "./settings";

export default class InlineAutocompletePlugin extends Plugin {
	public settings: AutocompleteSettings = { ...DEFAULT_SETTINGS };
	public engine: CompletionEngine = new CompletionEngine();

	private statusBarEl: HTMLElement | null = null;
	private popupSuggest: InlinePopupSuggest | null = null;

	public isAutocompleteActive(): boolean {
		if (!this.settings.enabled) return false;
		if (Platform.isMobile && this.settings.disableOnMobile) return false;
		return true;
	}

	async onload(): Promise<void> {
		await this.loadSettings();

		// 1. Register CodeMirror 6 Inline Ghost Text Extension
		this.registerEditorExtension(createGhostTextExtension(this));

		// 2. Register Obsidian EditorSuggest Popup Menu
		this.popupSuggest = new InlinePopupSuggest(this.app, this);
		this.registerEditorSuggest(this.popupSuggest);

		// 3. Status Bar Indicator (Desktop)
		if (!Platform.isMobile) {
			this.statusBarEl = this.addStatusBarItem();
			this.statusBarEl.addClass("iac-statusbar");
			this.statusBarEl.setAttribute(
				"title",
				"Click to toggle inline autocomplete · Right-click to rebuild vault index"
			);
			this.statusBarEl.addEventListener("click", () => {
				void this.toggleEnabled();
			});
			this.statusBarEl.addEventListener("contextmenu", (evt) => {
				evt.preventDefault();
				void this.rebuildVaultIndex().then(() =>
					new Notice("Vault autocomplete index rebuilt.")
				);
			});
			this.updateStatusBar();
		}

		// 4. Commands (including mobile toolbar-friendly ghost text actions)
		this.addCommand({
			id: "accept-ghost-completion",
			name: "Accept inline ghost completion",
			icon: "check",
			editorCheckCallback: (checking: boolean, editor: Editor) => {
				if (!this.isAutocompleteActive()) return false;
				if (checking) return true;
				const cmView = (editor as unknown as { cm?: EditorView }).cm;
				if (cmView) {
					acceptFullGhostCompletion(cmView);
				}
				return true;
			},
		});

		this.addCommand({
			id: "accept-next-word-ghost-completion",
			name: "Accept next word of ghost completion",
			icon: "arrow-right",
			editorCheckCallback: (checking: boolean, editor: Editor) => {
				if (!this.isAutocompleteActive()) return false;
				if (checking) return true;
				const cmView = (editor as unknown as { cm?: EditorView }).cm;
				if (cmView) {
					acceptNextWordGhostCompletion(cmView);
				}
				return true;
			},
		});

		this.addCommand({
			id: "cycle-next-ghost-completion",
			name: "Cycle next inline suggestion",
			icon: "refresh-cw",
			editorCheckCallback: (checking: boolean, editor: Editor) => {
				if (!this.isAutocompleteActive()) return false;
				if (checking) return true;
				const cmView = (editor as unknown as { cm?: EditorView }).cm;
				if (cmView) {
					cycleActiveGhostCompletion(cmView, 1);
				}
				return true;
			},
		});

		this.addCommand({
			id: "toggle-enabled",
			name: "Toggle autocomplete on/off",
			icon: "sparkles",
			callback: () => this.toggleEnabled(),
		});

		this.addCommand({
			id: "toggle-ghost-text",
			name: "Toggle inline ghost text",
			callback: async () => {
				this.settings.enableGhostText = !this.settings.enableGhostText;
				await this.saveSettings();
				new Notice(
					`Inline ghost text ${
						this.settings.enableGhostText ? "enabled" : "disabled"
					}`
				);
			},
		});

		this.addCommand({
			id: "toggle-popup-menu",
			name: "Toggle popup suggestion menu",
			callback: async () => {
				this.settings.enablePopupSuggest = !this.settings.enablePopupSuggest;
				await this.saveSettings();
				new Notice(
					`Popup suggestion menu ${
						this.settings.enablePopupSuggest ? "enabled" : "disabled"
					}`
				);
			},
		});

		this.addCommand({
			id: "create-snippet-from-selection",
			name: "Create autocomplete snippet from selection",
			editorCheckCallback: (checking: boolean, editor: Editor) => {
				const selected = editor.getSelection();
				if (checking) {
					return Boolean(selected && selected.trim());
				}
				new CreateSnippetModal(this.app, this, selected).open();
				return true;
			},
		});

		this.addCommand({
			id: "add-selection-to-dictionary",
			name: "Add selected word to custom dictionary",
			editorCheckCallback: (checking: boolean, editor: Editor) => {
				const selected = editor.getSelection().trim();
				if (checking) {
					return Boolean(selected);
				}
				if (!this.settings.customWords.includes(selected)) {
					this.settings.customWords.push(selected);
					void this.saveSettings();
				}
				new Notice(`Added "${selected}" to custom autocomplete dictionary.`);
				return true;
			},
		});

		this.addCommand({
			id: "rebuild-vault-index",
			name: "Rebuild vault autocomplete index",
			callback: async () => {
				await this.rebuildVaultIndex();
				const stats = this.engine.getStats();
				new Notice(
					`Indexed ${stats.uniqueWords.toLocaleString()} words and ${stats.uniquePhrases.toLocaleString()} phrases from ${stats.indexedFiles} notes.`
				);
			},
		});

		// 5. Settings Tab
		this.addSettingTab(new InlineAutocompleteSettingTab(this.app, this));

		// 6. Initial Vault Scan, Local Full Dictionary Load, & Incremental File Watchers
		this.app.workspace.onLayoutReady(async () => {
			if (!this.isAutocompleteActive()) {
				return;
			}
			await this.loadLocalDictionary();
			await this.rebuildVaultIndex();
		});

		const debouncedIndexFile = debounce(
			async (file: TFile) => {
				if (!this.isAutocompleteActive() || !this.isVaultIndexingEnabled()) {
					return;
				}
				try {
					const content = await this.app.vault.cachedRead(file);
					this.engine.indexFile(file.path, file.basename, content);
					this.updateStatusBar();
				} catch {
					// Ignore unreadable files
				}
			},
			600,
			true
		);

		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile && file.extension === "md") {
					debouncedIndexFile(file);
				}
			})
		);
		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (file instanceof TFile && file.extension === "md") {
					debouncedIndexFile(file);
				}
			})
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (file instanceof TFile && file.extension === "md") {
					if (!this.isAutocompleteActive()) {
						return;
					}
					this.engine.removeFile(file.path);
					this.updateStatusBar();
				}
			})
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (file instanceof TFile && file.extension === "md") {
					if (!this.isAutocompleteActive()) {
						return;
					}
					this.engine.removeFile(oldPath);
					debouncedIndexFile(file);
				}
			})
		);
	}

	onunload(): void {
		// Clear any active ghost completions across visible editors
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView) {
				const cmView = (leaf.view.editor as unknown as { cm?: EditorView }).cm;
				if (cmView) {
					dismissActiveGhostCompletion(cmView);
				}
			}
		});

		// Release indexes and caches from memory
		this.engine.clear();
	}

	public async loadLocalDictionary(): Promise<void> {
		if (!this.settings.useLocalFullDictionary) {
			if (this.settings.includeBuiltInDictionary) {
				this.engine.resetToBuiltInDictionary();
			} else {
				this.engine.dictionaryIndex.loadWords([], "Disabled");
			}
			this.updateStatusBar();
			return;
		}

		const customPath = this.settings.localDictionaryPath.trim();

		// 1. Vault path (works cross-platform on Desktop, iOS, iPadOS, Android with zero network calls)
		if (customPath) {
			if (await this.app.vault.adapter.exists(customPath)) {
				try {
					const raw = await this.app.vault.adapter.read(customPath);
					this.engine.loadExternalDictionary(raw, `Vault (${customPath})`);
					this.updateStatusBar();
					return;
				} catch {
					// Fall through to bundled dictionary
				}
			}
		}

		// 2. Bundled full English dictionary (~50,000 words)
		// Works 100% offline, native/bundled, zero network calls, zero external file dependencies
		this.engine.loadBundledDictionary();
		this.updateStatusBar();
	}

	/** True when at least one completion source needs to read vault notes. */
	public isVaultIndexingEnabled(): boolean {
		return (
			this.settings.indexVaultWords ||
			this.settings.indexNgramPhrases ||
			this.settings.indexNoteTitlesAndHeadings
		);
	}

	public async rebuildVaultIndex(): Promise<void> {
		if (!this.isVaultIndexingEnabled()) {
			this.engine.indexAllFiles([]);
			this.updateStatusBar();
			return;
		}
		const markdownFiles = this.app.vault.getMarkdownFiles();
		const batch: Array<{ path: string; title: string; content: string }> = [];

		for (const file of markdownFiles) {
			try {
				const content = await this.app.vault.cachedRead(file);
				batch.push({
					path: file.path,
					title: file.basename,
					content,
				});
			} catch {
				// Skip unreadable files
			}
		}

		this.engine.indexAllFiles(batch);
		this.updateStatusBar();
	}

	public updateStatusBar(): void {
		if (!this.statusBarEl) return;
		const stats = this.engine.getStats();
		if (this.settings.enabled) {
			this.statusBarEl.textContent = `✨ Auto: ON (${stats.uniqueWords})`;
			this.statusBarEl.removeClass("is-disabled");
		} else {
			this.statusBarEl.textContent = `✨ Auto: OFF`;
			this.statusBarEl.addClass("is-disabled");
		}
	}

	public async loadSettings(): Promise<void> {
		const raw = (await this.loadData()) as Partial<AutocompleteSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, raw);
		if (this.settings.disableOnMobile === undefined) {
			this.settings.disableOnMobile = DEFAULT_SETTINGS.disableOnMobile;
		}
		if (!Array.isArray(this.settings.snippets)) {
			this.settings.snippets = [...DEFAULT_SETTINGS.snippets];
		}
		if (!Array.isArray(this.settings.customWords)) {
			this.settings.customWords = [];
		}
	}

	public async toggleEnabled(): Promise<void> {
		this.settings.enabled = !this.settings.enabled;
		await this.saveSettings();
		new Notice(
			`Inline autocomplete ${this.settings.enabled ? "enabled" : "disabled"}`
		);
	}

	public async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.updateStatusBar();
	}
}
