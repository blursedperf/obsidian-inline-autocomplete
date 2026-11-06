export type CompletionKind =
	| "snippet"
	| "phrase"
	| "note"
	| "heading"
	| "word"
	| "dictionary";

export interface CustomSnippet {
	/** Short trigger prefix, e.g. ";date" or "callout" */
	trigger: string;
	/** Expanded text; supports {{date}}, {{time}}, {{title}}, and $CURSOR */
	expansion: string;
	/** Human-readable description shown in the popup menu */
	description: string;
}

export interface CompletionCandidate {
	/** Unique key for deduplication */
	id: string;
	/** Display label in the popup menu */
	label: string;
	/** Full replacement text for the matched prefix range */
	insertText: string;
	/** The prefix in the editor that was matched */
	matchedPrefix: string;
	/** The remaining inline suffix after the cursor for ghost text rendering */
	ghostSuffix: string;
	/** Optional offset from start of insertText where cursor should land (for $CURSOR in snippets) */
	cursorOffset?: number;
	/** Source category */
	kind: CompletionKind;
	/** Secondary badge / frequency info */
	detail: string;
	/** Relevance score (higher is better) */
	score: number;
}

export interface QueryContext {
	/** Text on the current line before the cursor */
	linePrefix: string;
	/** Current word prefix immediately before the cursor */
	wordPrefix: string;
	/** Previous word immediately before wordPrefix (for 2/3-gram phrase completion) */
	previousWord: string;
	/** Active note title (without .md) */
	activeNoteTitle: string;
	/** Active note path */
	activeFilePath: string;
}

export interface IndexStats {
	uniqueWords: number;
	uniquePhrases: number;
	noteTitlesAndHeadings: number;
	indexedFiles: number;
	dictionaryWords: number;
	dictionarySource: string;
}

export interface AutocompleteSettings {
	/** Master toggle for autocomplete */
	enabled: boolean;
	/** Disable autocomplete entirely on mobile devices (phones and tablets) */
	disableOnMobile: boolean;
	/** Show inline dimmed ghost text at the cursor */
	enableGhostText: boolean;
	/** Show floating popup suggestion list */
	enablePopupSuggest: boolean;
	/** Minimum characters typed before triggering completions */
	minPrefixLength: number;
	/** Maximum suggestions to return */
	maxSuggestions: number;
	/** Index individual words across all vault Markdown notes */
	indexVaultWords: boolean;
	/** Index 2-word and 3-word phrases across vault Markdown notes */
	indexNgramPhrases: boolean;
	/** Index note titles and section headings */
	indexNoteTitlesAndHeadings: boolean;
	/** Include built-in common English & Markdown vocabulary fallback */
	includeBuiltInDictionary: boolean;
	/** Load full local dictionary file from OS (/usr/share/dict/...) or custom path */
	useLocalFullDictionary: boolean;
	/** Optional custom path to a wordlist (.txt or Hunspell .dic); auto-detects OS dictionary if empty */
	localDictionaryPath: string;
	/** Adapt completion capitalization to match what the user typed */
	matchCaseSmartly: boolean;
	/** Suppress completions when cursor is inside a fenced code block */
	ignoreCodeBlocks: boolean;
	/** Suppress completions when cursor is inside YAML frontmatter */
	ignoreFrontmatter: boolean;
	/** User-defined text expansion snippets */
	snippets: CustomSnippet[];
	/** User-defined custom dictionary words */
	customWords: string[];
}

export const DEFAULT_SNIPPETS: CustomSnippet[] = [
	{
		trigger: "td",
		expansion: "- [ ] $CURSOR",
		description: "Markdown task checkbox",
	},
	{
		trigger: "callout",
		expansion: "> [!note] $CURSOR\n> ",
		description: "Obsidian note callout block",
	},
	{
		trigger: "warn",
		expansion: "> [!warning] $CURSOR\n> ",
		description: "Obsidian warning callout block",
	},
	{
		trigger: "today",
		expansion: "{{date}}",
		description: "Insert current ISO date (YYYY-MM-DD)",
	},
	{
		trigger: "now",
		expansion: "{{date}} {{time}}",
		description: "Insert current date and time",
	},
	{
		trigger: "frontmatter",
		expansion: "---\ntitle: {{title}}\ndate: {{date}}\ntags:\n  - $CURSOR\n---\n",
		description: "YAML frontmatter template",
	},
	{
		trigger: "table2",
		expansion: "| Column 1 | Column 2 |\n| --- | --- |\n| $CURSOR |  |",
		description: "2-column Markdown table",
	},
];

export const DEFAULT_SETTINGS: AutocompleteSettings = {
	enabled: true,
	disableOnMobile: false,
	enableGhostText: true,
	enablePopupSuggest: true,
	minPrefixLength: 2,
	maxSuggestions: 8,
	indexVaultWords: true,
	indexNgramPhrases: true,
	indexNoteTitlesAndHeadings: true,
	includeBuiltInDictionary: true,
	useLocalFullDictionary: true,
	localDictionaryPath: "",
	matchCaseSmartly: true,
	ignoreCodeBlocks: false,
	ignoreFrontmatter: true,
	snippets: [...DEFAULT_SNIPPETS],
	customWords: [],
};
