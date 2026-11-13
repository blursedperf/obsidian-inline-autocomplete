import {
	AutocompleteSettings,
	CompletionCandidate,
	IndexStats,
	QueryContext,
} from "./types";
import { PrefixDictionaryIndex } from "./dictionary";

interface FileIndexEntry {
	title: string;
	headings: string[];
	wordCounts: Map<string, { canonical: string; count: number }>;
	phrasesByFirstWord: Map<string, Map<string, number>>;
}

/**
 * Apply the capitalization pattern of `prefix` onto `target` when `target` is lowercase.
 */
export function applySmartCase(prefix: string, target: string): string {
	if (!prefix) return target;
	// Only transform if target is all-lowercase or standard casing
	const isAllUpper =
		prefix.length > 1 &&
		prefix === prefix.toUpperCase() &&
		prefix !== prefix.toLowerCase();
	if (isAllUpper) {
		return target.toUpperCase();
	}
	const isTitleCase =
		prefix[0] === prefix[0].toUpperCase() &&
		prefix[0] !== prefix[0].toLowerCase() &&
		prefix.slice(1) === prefix.slice(1).toLowerCase();
	if (isTitleCase && target[0] === target[0].toLowerCase()) {
		return target[0].toUpperCase() + target.slice(1);
	}
	return target;
}

/**
 * Expand snippet template variables ({{date}}, {{time}}, {{title}}) and locate $CURSOR.
 */
export function expandSnippetTemplate(
	template: string,
	noteTitle: string,
	now: Date = new Date()
): { text: string; cursorOffset?: number } {
	const yyyy = now.getFullYear();
	const mm = String(now.getMonth() + 1).padStart(2, "0");
	const dd = String(now.getDate()).padStart(2, "0");
	const hh = String(now.getHours()).padStart(2, "0");
	const min = String(now.getMinutes()).padStart(2, "0");

	const expanded = template
		.replace(/\{\{date\}\}/g, `${yyyy}-${mm}-${dd}`)
		.replace(/\{\{time\}\}/g, `${hh}:${min}`)
		.replace(/\{\{title\}\}/g, noteTitle || "Untitled");

	const cursorMarker = "$CURSOR";
	const markerIdx = expanded.indexOf(cursorMarker);
	if (markerIdx !== -1) {
		return {
			text:
				expanded.slice(0, markerIdx) +
				expanded.slice(markerIdx + cursorMarker.length),
			cursorOffset: markerIdx,
		};
	}
	return { text: expanded };
}

/**
 * Returns true if `linePrefix` places the cursor inside an unclosed wikilink (`[[...` or `![[...`),
 * an unclosed markdown link destination (`[text](...`), or a `#tag`, where Obsidian's native
 * suggestion popup should control Tab / Enter without interference.
 */
export function isCursorInLinkOrTag(linePrefix: string): boolean {
	// Unclosed [[wikilink]] or ![[embed]]
	const openWikiIdx = linePrefix.lastIndexOf("[[");
	const closeWikiIdx = linePrefix.lastIndexOf("]]");
	if (openWikiIdx !== -1 && openWikiIdx > closeWikiIdx) {
		return true;
	}

	// Unclosed Markdown link destination [label](url...
	if (/\]\([^)]*$/.test(linePrefix)) {
		return true;
	}

	// Native #tag completion
	if (/(?:^|\s)#[A-Za-z0-9_/-]*$/.test(linePrefix)) {
		return true;
	}

	return false;
}

/**
 * Extract the current word prefix and preceding word from the line text before the cursor.
 */
export function extractQueryContext(
	linePrefix: string,
	activeNoteTitle = "",
	activeFilePath = ""
): QueryContext {
	if (isCursorInLinkOrTag(linePrefix)) {
		return {
			linePrefix,
			wordPrefix: "",
			previousWord: "",
			activeNoteTitle,
			activeFilePath,
		};
	}

	// Match current word prefix (allowing leading ; or / for snippet triggers)
	const wordMatch = linePrefix.match(/(?:^|\s)([;/]?[A-Za-z0-9_-]+)$/);
	const wordPrefix = wordMatch ? wordMatch[1] : "";

	const beforeWord = linePrefix.slice(
		0,
		linePrefix.length - wordPrefix.length
	);
	const prevMatch = beforeWord.match(/([A-Za-z0-9_-]+)\s$/);
	const previousWord = prevMatch ? prevMatch[1] : "";

	return {
		linePrefix,
		wordPrefix,
		previousWord,
		activeNoteTitle,
		activeFilePath,
	};
}

/**
 * Check if cursor position in document text is inside YAML frontmatter or a fenced code block.
 */
export function getDocumentCursorContext(
	docText: string,
	cursorOffset: number
): { inFrontmatter: boolean; inCodeBlock: boolean } {
	const textBefore = docText.slice(0, cursorOffset);
	const lines = textBefore.split(/\r?\n/);

	let inFrontmatter = false;
	if (lines.length > 0 && lines[0].trim() === "---") {
		inFrontmatter = true;
		for (let i = 1; i < lines.length; i++) {
			const t = lines[i].trim();
			if (t === "---" || t === "...") {
				inFrontmatter = false;
				break;
			}
		}
	}

	let inCodeBlock = false;
	for (let i = 0; i < lines.length; i++) {
		const t = lines[i].trim();
		if (t.startsWith("```") || t.startsWith("~~~")) {
			inCodeBlock = !inCodeBlock;
		}
	}

	return { inFrontmatter, inCodeBlock };
}

/** Characters that end a phrase: n-grams never span punctuation, brackets or link and markup syntax. */
const PHRASE_BREAK_REGEX = /[^A-Za-z0-9'\u2019\s-]+/;
/** A token: letters and digits, with inner hyphens or apostrophes ("well-known", "Atkin's"). */
const TOKEN_REGEX = /[A-Za-z0-9]+(?:[-'\u2019][A-Za-z0-9]+)*/g;
const VOCAB_WORD_REGEX = /^[A-Za-z][A-Za-z0-9-]*$/;

/**
 * Split a line into phrase runs of tokens. Short tokens such as "v", "R" and "s" and numbers stay in
 * the run so case names ("Donoghue v Stevenson", "R v Smith") are learned as written, and a run ends
 * at punctuation so dropped text never joins unrelated words into a false phrase.
 */
export function tokenizePhraseRuns(line: string): string[][] {
	const stripped = line
		.replace(/https?:\/\/\S+/g, " | ")
		.replace(/[*_`~]/g, " ");
	const runs: string[][] = [];
	for (const segment of stripped.split(PHRASE_BREAK_REGEX)) {
		const tokens = segment.match(TOKEN_REGEX);
		if (tokens && tokens.length > 0) runs.push(tokens);
	}
	return runs;
}

/** Count a line's vocabulary words and its 2- and 3-word phrases into a file's index maps. */
function indexLineTokens(
	line: string,
	wordCounts: Map<string, { canonical: string; count: number }>,
	phrasesByFirstWord: Map<string, Map<string, number>>
): void {
	for (const tokens of tokenizePhraseRuns(line)) {
		for (const token of tokens) {
			// Vocabulary words: 4-36 letters, possessive suffix dropped ("Atkin's" -> "Atkin")
			const word = token.split(/['\u2019]/)[0];
			if (word.length < 4 || word.length > 36 || !VOCAB_WORD_REGEX.test(word)) continue;
			const lower = word.toLowerCase();
			const existing = wordCounts.get(lower);
			if (existing) {
				existing.count += 1;
				// Prefer lowercase canonical form if available
				if (word === lower) existing.canonical = word;
			} else {
				wordCounts.set(lower, { canonical: word, count: 1 });
			}
		}

		// 2-word phrases need a meaningful second word; 3-word phrases may pass through a
		// short middle token ("Donoghue v Stevenson") as long as the last word is meaningful.
		for (let idx = 0; idx < tokens.length - 1; idx++) {
			const w1 = tokens[idx];
			const w2 = tokens[idx + 1];
			const w3 = tokens[idx + 2];
			const bigram = w2.length >= 3 ? `${w1} ${w2}` : null;
			const trigram = w3 !== undefined && w3.length >= 3 ? `${w1} ${w2} ${w3}` : null;
			if (!bigram && !trigram) continue;

			const firstKey = w1.toLowerCase();
			let phraseMap = phrasesByFirstWord.get(firstKey);
			if (!phraseMap) {
				phraseMap = new Map();
				phrasesByFirstWord.set(firstKey, phraseMap);
			}
			if (bigram) phraseMap.set(bigram, (phraseMap.get(bigram) ?? 0) + 1);
			if (trigram) phraseMap.set(trigram, (phraseMap.get(trigram) ?? 0) + 1);
		}
	}
}

export class CompletionEngine {
	private fileEntries: Map<string, FileIndexEntry> = new Map();
	private globalWords: Map<string, { canonical: string; count: number }> =
		new Map();
	private globalPhrases: Map<string, Map<string, number>> = new Map();
	private globalTitlesAndHeadings: Map<string, { text: string; kind: "note" | "heading" }> =
		new Map();
	public dictionaryIndex: PrefixDictionaryIndex = new PrefixDictionaryIndex();

	public loadExternalDictionary(rawText: string, sourceLabel: string): number {
		return this.dictionaryIndex.loadFromRawText(rawText, sourceLabel, true);
	}

	public loadBundledDictionary(): number {
		return this.dictionaryIndex.loadBundledDictionary();
	}

	public resetToBuiltInDictionary(): void {
		this.dictionaryIndex.resetToBuiltInDictionary();
	}

	public clear(): void {
		this.fileEntries.clear();
		this.globalWords.clear();
		this.globalPhrases.clear();
		this.globalTitlesAndHeadings.clear();
		this.dictionaryIndex.clear();
	}

	/**
	 * Index or re-index a single Markdown file.
	 */
	public indexFile(filePath: string, title: string, content: string): void {
		const lines = content.split(/\r?\n/);
		const headings: string[] = [];
		const wordCounts = new Map<string, { canonical: string; count: number }>();
		const phrasesByFirstWord = new Map<string, Map<string, number>>();

		let startLine = 0;
		if (lines.length > 0 && lines[0].trim() === "---") {
			for (let i = 1; i < lines.length; i++) {
				if (lines[i].trim() === "---" || lines[i].trim() === "...") {
					startLine = i + 1;
					break;
				}
			}
		}

		let inFence = false;
		const cleanLines: string[] = [];

		for (let i = startLine; i < lines.length; i++) {
			const line = lines[i];
			const trimmed = line.trim();
			if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
				inFence = !inFence;
				continue;
			}
			if (inFence) continue;

			const headingMatch = trimmed.match(/^#{1,6}\s+(.+)$/);
			if (headingMatch) {
				const hText = headingMatch[1]
					.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
					.replace(/[#*_`~]/g, "")
					.trim();
				if (hText.length >= 3) {
					headings.push(hText);
				}
			}

			cleanLines.push(line);
		}

		// Tokenize words and n-gram phrases per line
		for (const line of cleanLines) {
			indexLineTokens(line, wordCounts, phrasesByFirstWord);
		}

		this.fileEntries.set(filePath, {
			title,
			headings,
			wordCounts,
			phrasesByFirstWord,
		});

		this.rebuildGlobalAggregates();
	}

	/**
	 * Batch-index multiple files and rebuild aggregates once at the end.
	 */
	public indexAllFiles(
		files: Array<{ path: string; title: string; content: string }>
	): void {
		this.fileEntries.clear();
		for (const f of files) {
			this.indexFileWithoutRebuild(f.path, f.title, f.content);
		}
		this.rebuildGlobalAggregates();
	}

	public removeFile(filePath: string): void {
		if (this.fileEntries.delete(filePath)) {
			this.rebuildGlobalAggregates();
		}
	}

	public getStats(): IndexStats {
		return {
			uniqueWords: this.globalWords.size,
			uniquePhrases: Array.from(this.globalPhrases.values()).reduce(
				(acc, m) => acc + m.size,
				0
			),
			noteTitlesAndHeadings: this.globalTitlesAndHeadings.size,
			indexedFiles: this.fileEntries.size,
			dictionaryWords: this.dictionaryIndex.getWordCount(),
			dictionarySource: this.dictionaryIndex.getSourceLabel(),
		};
	}

	/**
	 * Query ranked inline autocomplete candidates for the current cursor context.
	 */
	public query(
		context: QueryContext,
		settings: AutocompleteSettings,
		now: Date = new Date()
	): CompletionCandidate[] {
		if (!settings.enabled) return [];
		if (isCursorInLinkOrTag(context.linePrefix)) return [];

		const {
			wordPrefix,
			previousWord,
			activeNoteTitle,
			activeFilePath,
		} = context;
		const minLen = Math.max(1, settings.minPrefixLength);

		// Allow phrase completion after a space if previousWord exists and wordPrefix >= 1,
		// or standard completion when wordPrefix.length >= minLen
		const canQueryWord = wordPrefix.length >= minLen;
		const canQueryPhrase =
			settings.indexNgramPhrases &&
			previousWord.length >= 1 &&
			wordPrefix.length >= 1;

		if (!canQueryWord && !canQueryPhrase) {
			return [];
		}

		const lowerPrefix = wordPrefix.toLowerCase();
		const candidates = new Map<string, CompletionCandidate>();

		const addCandidate = (candidate: CompletionCandidate) => {
			const key = candidate.insertText.toLowerCase();
			// Never suggest exact same text the user already typed
			if (candidate.ghostSuffix.length === 0 && candidate.kind !== "snippet") {
				return;
			}
			const existing = candidates.get(key);
			if (!existing || candidate.score > existing.score) {
				candidates.set(key, candidate);
			}
		};

		// 1. Custom Snippets (highest priority when trigger matches)
		if (wordPrefix.length >= 1) {
			for (const snippet of settings.snippets) {
				const trig = snippet.trigger.trim();
				if (!trig) continue;
				if (
					trig.toLowerCase().startsWith(lowerPrefix) &&
					wordPrefix.length >= Math.min(minLen, trig.length)
				) {
					const { text: expandedText, cursorOffset } = expandSnippetTemplate(
						snippet.expansion,
						activeNoteTitle,
						now
					);
					const firstLine = expandedText.split("\n")[0];
					const isExactTrigger = trig.toLowerCase() === lowerPrefix;
					const ghostPreview = isExactTrigger
						? ` → ${firstLine}`
						: `${trig.slice(wordPrefix.length)} → ${firstLine}`;

					addCandidate({
						id: `snippet:${trig}`,
						label: `${trig} → ${snippet.description || firstLine}`,
						insertText: expandedText,
						matchedPrefix: wordPrefix,
						ghostSuffix: ghostPreview,
						cursorOffset,
						kind: "snippet",
						detail: snippet.description || "Snippet",
						score: isExactTrigger ? 1000 : 850 + (wordPrefix.length / trig.length) * 100,
					});
				}
			}
		}

		// 2. N-Gram Phrases (when previousWord matches indexed bigrams/trigrams)
		if (canQueryPhrase) {
			const prevLower = previousWord.toLowerCase();
			const combinedTyped = `${previousWord} ${wordPrefix}`;
			const combinedLower = combinedTyped.toLowerCase();

			const phraseMap = this.globalPhrases.get(prevLower);
			if (phraseMap) {
				for (const [phrase, count] of phraseMap.entries()) {
					const phraseLower = phrase.toLowerCase();
					if (
						phraseLower.startsWith(combinedLower) &&
						phrase.length > combinedTyped.length
					) {
						// Extract the portion starting from wordPrefix so replacement only replaces wordPrefix
						const completionFromCurrentWord = phrase.slice(
							previousWord.length + 1
						);
						const adapted = settings.matchCaseSmartly
							? applySmartCase(wordPrefix, completionFromCurrentWord)
							: completionFromCurrentWord;
						const ghostSuffix = adapted.slice(wordPrefix.length);

						addCandidate({
							id: `phrase:${phraseLower}`,
							label: phrase,
							insertText: adapted,
							matchedPrefix: wordPrefix,
							ghostSuffix,
							kind: "phrase",
							detail: `Phrase (${count}×)`,
							score: 650 + Math.min(150, count * 25),
						});
					}
				}
			}
		}

		if (!canQueryWord) {
			return Array.from(candidates.values())
				.sort((a, b) => b.score - a.score)
				.slice(0, settings.maxSuggestions);
		}

		// 3. Custom User Dictionary Words
		for (const customWord of settings.customWords) {
			const w = customWord.trim();
			if (w.length <= wordPrefix.length) continue;
			if (w.toLowerCase().startsWith(lowerPrefix)) {
				const adapted = settings.matchCaseSmartly
					? applySmartCase(wordPrefix, w)
					: w;
				addCandidate({
					id: `custom:${w.toLowerCase()}`,
					label: adapted,
					insertText: adapted,
					matchedPrefix: wordPrefix,
					ghostSuffix: adapted.slice(wordPrefix.length),
					kind: "dictionary",
					detail: "Custom word",
					score: 620 + (wordPrefix.length / w.length) * 60,
				});
			}
		}

		// 4. Note Titles & Headings
		if (settings.indexNoteTitlesAndHeadings) {
			for (const [, entry] of this.globalTitlesAndHeadings) {
				const text = entry.text;
				if (text.length <= wordPrefix.length) continue;
				const textLower = text.toLowerCase();
				if (textLower.startsWith(lowerPrefix)) {
					const adapted = settings.matchCaseSmartly
						? applySmartCase(wordPrefix, text)
						: text;
					addCandidate({
						id: `${entry.kind}:${textLower}`,
						label: adapted,
						insertText: adapted,
						matchedPrefix: wordPrefix,
						ghostSuffix: adapted.slice(wordPrefix.length),
						kind: entry.kind,
						detail: entry.kind === "note" ? "Note title" : "Heading",
						score: 540 + (wordPrefix.length / text.length) * 50,
					});
				}
			}
		}

		// 5. Vault Words (with boost for words in the currently active file)
		if (settings.indexVaultWords) {
			const activeFileEntry = activeFilePath
				? this.fileEntries.get(activeFilePath)
				: undefined;

			for (const [lowerWord, info] of this.globalWords.entries()) {
				if (lowerWord.length <= wordPrefix.length) continue;
				if (lowerWord.startsWith(lowerPrefix)) {
					const localCount =
						activeFileEntry?.wordCounts.get(lowerWord)?.count ?? 0;
					const effectiveCount = info.count + localCount * 3;
					const prefixRatio = wordPrefix.length / lowerWord.length;
					const freqScore = Math.min(140, Math.log2(effectiveCount + 1) * 28);
					const localBoost = localCount > 0 ? 65 : 0;

					const adapted = settings.matchCaseSmartly
						? applySmartCase(wordPrefix, info.canonical)
						: info.canonical;

					addCandidate({
						id: `word:${lowerWord}`,
						label: adapted,
						insertText: adapted,
						matchedPrefix: wordPrefix,
						ghostSuffix: adapted.slice(wordPrefix.length),
						kind: "word",
						detail:
							localCount > 0
								? `Current note (${info.count}×)`
								: `Vault (${info.count}×)`,
						score: 400 + freqScore + localBoost + prefixRatio * 55,
					});
				}
			}
		}

		// 6. Local Full Dictionary / Built-in Dictionary Fallback (O(1) 2-char bucket lookup)
		if (settings.includeBuiltInDictionary || settings.useLocalFullDictionary) {
			const dictMatches = this.dictionaryIndex.findPrefixMatches(
				lowerPrefix,
				Math.max(12, settings.maxSuggestions * 2)
			);
			for (const dictWord of dictMatches) {
				const adapted = settings.matchCaseSmartly
					? applySmartCase(wordPrefix, dictWord)
					: dictWord;
				const prefixRatio = wordPrefix.length / dictWord.length;

				addCandidate({
					id: `dict:${dictWord}`,
					label: adapted,
					insertText: adapted,
					matchedPrefix: wordPrefix,
					ghostSuffix: adapted.slice(wordPrefix.length),
					kind: "dictionary",
					detail: "Dictionary",
					score: 300 + prefixRatio * 50,
				});
			}
		}

		return Array.from(candidates.values())
			.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
			.slice(0, settings.maxSuggestions);
	}

	private indexFileWithoutRebuild(
		filePath: string,
		title: string,
		content: string
	): void {
		// Re-use indexFile logic without calling rebuildGlobalAggregates until the batch finishes
		const lines = content.split(/\r?\n/);
		const headings: string[] = [];
		const wordCounts = new Map<string, { canonical: string; count: number }>();
		const phrasesByFirstWord = new Map<string, Map<string, number>>();

		let startLine = 0;
		if (lines.length > 0 && lines[0].trim() === "---") {
			for (let i = 1; i < lines.length; i++) {
				if (lines[i].trim() === "---" || lines[i].trim() === "...") {
					startLine = i + 1;
					break;
				}
			}
		}

		let inFence = false;
		for (let i = startLine; i < lines.length; i++) {
			const line = lines[i];
			const trimmed = line.trim();
			if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
				inFence = !inFence;
				continue;
			}
			if (inFence) continue;

			const headingMatch = trimmed.match(/^#{1,6}\s+(.+)$/);
			if (headingMatch) {
				const hText = headingMatch[1]
					.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
					.replace(/[#*_`~]/g, "")
					.trim();
				if (hText.length >= 3) {
					headings.push(hText);
				}
			}

			indexLineTokens(line, wordCounts, phrasesByFirstWord);
		}

		this.fileEntries.set(filePath, {
			title,
			headings,
			wordCounts,
			phrasesByFirstWord,
		});
	}

	private rebuildGlobalAggregates(): void {
		this.globalWords.clear();
		this.globalPhrases.clear();
		this.globalTitlesAndHeadings.clear();

		for (const [, entry] of this.fileEntries) {
			if (entry.title && entry.title.length >= 3) {
				this.globalTitlesAndHeadings.set(entry.title.toLowerCase(), {
					text: entry.title,
					kind: "note",
				});
			}
			for (const h of entry.headings) {
				const hLower = h.toLowerCase();
				if (!this.globalTitlesAndHeadings.has(hLower)) {
					this.globalTitlesAndHeadings.set(hLower, {
						text: h,
						kind: "heading",
					});
				}
			}

			for (const [lower, info] of entry.wordCounts) {
				const existing = this.globalWords.get(lower);
				if (existing) {
					existing.count += info.count;
					if (info.canonical === lower) {
						existing.canonical = info.canonical;
					}
				} else {
					this.globalWords.set(lower, {
						canonical: info.canonical,
						count: info.count,
					});
				}
			}

			for (const [firstWord, phraseMap] of entry.phrasesByFirstWord) {
				let globalMap = this.globalPhrases.get(firstWord);
				if (!globalMap) {
					globalMap = new Map();
					this.globalPhrases.set(firstWord, globalMap);
				}
				for (const [phrase, count] of phraseMap) {
					globalMap.set(phrase, (globalMap.get(phrase) ?? 0) + count);
				}
			}
		}
	}
}
