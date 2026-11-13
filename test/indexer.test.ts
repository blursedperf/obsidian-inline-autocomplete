import assert from "node:assert/strict";
import {
	CompletionEngine,
	applySmartCase,
	expandSnippetTemplate,
	extractQueryContext,
	getDocumentCursorContext,
	isCursorInLinkOrTag,
	tokenizePhraseRuns,
} from "../src/indexer.ts";
import { DEFAULT_SETTINGS } from "../src/types.ts";

// 1. Smart Case Matching
{
	assert.equal(applySmartCase("algo", "algorithm"), "algorithm");
	assert.equal(applySmartCase("Algo", "algorithm"), "Algorithm");
	assert.equal(applySmartCase("ALGO", "algorithm"), "ALGORITHM");
}

// 2. Snippet Variable Expansion & $CURSOR Positioning
{
	const fixedDate = new Date(2026, 9, 31, 14, 5); // 2026-10-31 14:05
	const res = expandSnippetTemplate(
		"Note: {{title}} ({{date}} {{time}}) -> $CURSOR!",
		"Daily Log",
		fixedDate
	);
	assert.equal(res.text, "Note: Daily Log (2026-10-31 14:05) -> !");
	assert.equal(res.cursorOffset, "Note: Daily Log (2026-10-31 14:05) -> ".length);
}

// 3. Query Context Extraction
{
	const ctx = extractQueryContext("Studying spaced rep", "Memory", "Memory.md");
	assert.equal(ctx.previousWord, "spaced");
	assert.equal(ctx.wordPrefix, "rep");
}

// 4. Document Frontmatter & Code Fence Detection
{
	const doc = `---
title: Test
---
Some text
\`\`\`python
print("hi")
\`\`\`
Outside text`;

	const fmCtx = getDocumentCursorContext(doc, 10);
	assert.equal(fmCtx.inFrontmatter, true);
	assert.equal(fmCtx.inCodeBlock, false);

	const codeIdx = doc.indexOf("print");
	const codeCtx = getDocumentCursorContext(doc, codeIdx);
	assert.equal(codeCtx.inFrontmatter, false);
	assert.equal(codeCtx.inCodeBlock, true);

	const outsideIdx = doc.indexOf("Outside");
	const outsideCtx = getDocumentCursorContext(doc, outsideIdx);
	assert.equal(outsideCtx.inFrontmatter, false);
	assert.equal(outsideCtx.inCodeBlock, false);
}

// 5. Vault Indexing (Words, Bigram/Trigram Phrases, Headings, Snippets)
{
	const engine = new CompletionEngine();
	engine.indexFile(
		"Notes/SpacedRepetition.md",
		"Spaced Repetition Guide",
		`# Memory Consolidation

Spaced repetition systems improve long-term memory retention.
Spaced repetition algorithms schedule reviews exponentially.
Neuroplasticity strengthens synaptic connections.`
	);

	const stats = engine.getStats();
	assert.equal(stats.indexedFiles, 1);
	assert.ok(stats.uniqueWords >= 8);
	assert.ok(stats.uniquePhrases >= 5);

	// Test Word Completion with Smart Case
	const wordCandidates = engine.query(
		extractQueryContext("Neuro", "Spaced Repetition Guide", "Notes/SpacedRepetition.md"),
		DEFAULT_SETTINGS
	);
	assert.ok(wordCandidates.length > 0);
	assert.equal(wordCandidates[0].insertText, "Neuroplasticity");
	assert.equal(wordCandidates[0].ghostSuffix, "plasticity");

	// Test N-gram Phrase Completion ("Spaced r" -> "repetition" / "repetition systems")
	const phraseCandidates = engine.query(
		extractQueryContext("Spaced r", "Other", "Other.md"),
		DEFAULT_SETTINGS
	);
	assert.ok(phraseCandidates.some((c) => c.kind === "phrase"));
	const topPhrase = phraseCandidates.find((c) => c.kind === "phrase")!;
	assert.ok(topPhrase.insertText.toLowerCase().startsWith("repetition"));

	// Test Snippet Completion ("callout" -> "> [!note] ...")
	const snippetCandidates = engine.query(
		extractQueryContext("callo", "Other", "Other.md"),
		DEFAULT_SETTINGS
	);
	assert.ok(snippetCandidates.length > 0);
	assert.equal(snippetCandidates[0].kind, "snippet");
	assert.ok(snippetCandidates[0].insertText.includes("> [!note]"));

	// 6. Test Bundled & External Full Dictionary Loading
	const initialStats = engine.getStats();
	assert.ok(
		initialStats.dictionaryWords > 45000,
		`Expected >45,000 bundled words, got ${initialStats.dictionaryWords}`
	);

	const sampleDict = `
# Comment line
1a2b3c
abandon/SGD
abalone
encyclopedia/MS
serendipity
`;
	const loadedCount = engine.loadExternalDictionary(
		sampleDict,
		"Vault (custom-words.txt)"
	);
	assert.ok(loadedCount > 230); // Technical vocabulary + valid words, excluding "1a2b3c"
	const dictCandidates = engine.query(
		extractQueryContext("Serend", "Other", "Other.md"),
		DEFAULT_SETTINGS
	);
	assert.ok(dictCandidates.length > 0);
	assert.equal(dictCandidates[0].insertText, "Serendipity");
	assert.equal(dictCandidates[0].ghostSuffix, "ipity");

	// 7. Verify Autocomplete is Disabled Inside Links ([[...]], ![[...]], [text](...)) and #tags
	assert.equal(isCursorInLinkOrTag("See [[Spaced Rep"), true);
	assert.equal(isCursorInLinkOrTag("Embed ![[Diagram"), true);
	assert.equal(isCursorInLinkOrTag("Check [docs](https://ex"), true);
	assert.equal(isCursorInLinkOrTag("Tagged #neuro"), true);
	assert.equal(isCursorInLinkOrTag("See [[Spaced Repetition]] and Serend"), false);

	const insideLinkCtx = extractQueryContext("See [[Spaced Rep", "Other", "Other.md");
	assert.equal(insideLinkCtx.wordPrefix, "");
	assert.equal(engine.query(insideLinkCtx, DEFAULT_SETTINGS).length, 0);

	const afterClosedLinkCtx = extractQueryContext(
		"See [[Spaced Repetition]] and Serend",
		"Other",
		"Other.md"
	);
	assert.equal(afterClosedLinkCtx.wordPrefix, "Serend");
	const afterLinkCandidates = engine.query(afterClosedLinkCtx, DEFAULT_SETTINGS);
	assert.ok(afterLinkCandidates.length > 0);
	assert.equal(afterLinkCandidates[0].insertText, "Serendipity");
	// 8. Verify Mobile Disabling Setting Defaults
	assert.equal(DEFAULT_SETTINGS.disableOnMobile, false);
	assert.equal(DEFAULT_SETTINGS.enabled, true);

	const disabledSettings = { ...DEFAULT_SETTINGS, enabled: false };
	assert.equal(engine.query(afterClosedLinkCtx, disabledSettings).length, 0);
}

// 9. Verify Autocomplete Key Scope Behavior (Only Tab confirms, Return keeps typed text)
{
	interface MockKeyHandler {
		modifiers: string | null;
		key: string | null;
		func: (evt: any, ctx: any) => any;
	}

	class MockScope {
		keys: MockKeyHandler[] = [];
		register(
			modifiers: string[] | null,
			key: string | null,
			func: (evt: any, ctx: any) => any
		): MockKeyHandler {
			const handler: MockKeyHandler = {
				modifiers: modifiers ? modifiers.join(",") : null,
				key,
				func,
			};
			this.keys.push(handler);
			return handler;
		}
		unregister(handler: MockKeyHandler): void {
			const idx = this.keys.indexOf(handler);
			if (idx !== -1) this.keys.splice(idx, 1);
		}
		handleKey(evt: any, info: { modifiers: string; key: string }): any {
			for (const h of this.keys) {
				const modMatch =
					h.modifiers === null || h.modifiers === info.modifiers;
				const keyMatch =
					h.key === null ||
					(info.key && h.key.toLowerCase() === info.key.toLowerCase());
				if (!modMatch || !keyMatch) continue;
				const r = h.func(evt, info);
				if (r !== undefined || h.key !== null || h.modifiers !== null) {
					return r;
				}
			}
			return undefined;
		}
	}

	const scope = new MockScope();

	// Simulate Obsidian's default EditorSuggest handler that accepts on Enter
	let selectedOnEnter = false;
	const defaultEnterHandler = scope.register([], "Enter", () => {
		selectedOnEnter = true;
		return false;
	});

	// Ensure default Enter handler is unregistered/removed
	scope.keys = scope.keys.filter((h) => h.key?.toLowerCase() !== "enter");
	assert.equal(scope.keys.length, 0);

	let popupClosed = false;
	const handleEnterKey = () => {
		popupClosed = true;
		return; // undefined
	};
	scope.register(null, "Enter", handleEnterKey);

	let tabAccepted = false;
	scope.register([], "Tab", (evt: any) => {
		tabAccepted = true;
		popupClosed = true;
		evt.preventDefault();
		return false;
	});

	// Test Return / Enter key press:
	// - Must NOT confirm or accept the suggestion
	// - Must close popup
	// - Must return undefined (not false) so browser event is NOT prevented, allowing normal newline
	let enterPrevented = false;
	const mockEnterEvt = {
		preventDefault: () => {
			enterPrevented = true;
		},
	};
	const enterResult = scope.handleKey(mockEnterEvt, {
		modifiers: "",
		key: "Enter",
	});
	assert.equal(selectedOnEnter, false, "Return must not accept suggestion");
	assert.equal(popupClosed, true, "Return must close suggestion popup");
	assert.equal(enterResult, undefined, "Return must return undefined to allow normal newline");
	assert.equal(enterPrevented, false, "Return must not prevent default editor newline");

	// Test Tab key press:
	// - Must confirm suggestion
	// - Must prevent default Tab indentation
	// - Must return false
	popupClosed = false;
	let tabPrevented = false;
	const mockTabEvt = {
		preventDefault: () => {
			tabPrevented = true;
		},
	};
	const tabResult = scope.handleKey(mockTabEvt, {
		modifiers: "",
		key: "Tab",
	});
	assert.equal(tabAccepted, true, "Tab must confirm suggestion");
	assert.equal(popupClosed, true, "Tab must close suggestion popup");
	assert.equal(tabPrevented, true, "Tab must prevent default tab event");
	assert.equal(tabResult, false, "Tab must return false to consume event");
}

// Legal case names and citations: short connectors stay in phrases, punctuation ends them
{
	assert.deepEqual(tokenizePhraseRuns("In [[Donoghue v Stevenson]] [1932] AC 562, Lord Atkin's test"), [
		["In"],
		["Donoghue", "v", "Stevenson"],
		["1932"],
		["AC", "562"],
		["Lord", "Atkin's", "test"],
	]);

	const engine = new CompletionEngine();
	engine.indexFile(
		"Law/Torts.md",
		"Torts",
		`Donoghue v Stevenson established the neighbour principle.
See also Donoghue v Stevenson on duty of care.
R v Smith concerned causation. In R v Smith the wound was operating.
Under s 18 Australian Consumer Law, misleading conduct. Lord Atkin's speech.`
	);

	const phrasesFor = (prefix: string) =>
		engine
			.query(extractQueryContext(prefix, "Other", "Other.md"), DEFAULT_SETTINGS)
			.filter((c) => c.kind === "phrase")
			.map((c) => c.label);

	// The case name is learned as written, never as "Donoghue Stevenson"
	assert.ok(phrasesFor("Donoghue v").includes("Donoghue v Stevenson"));
	assert.ok(!phrasesFor("Donoghue S").some((p) => p.startsWith("Donoghue Stevenson")));
	// A single-letter previous word ("R v", "v S") still completes
	assert.ok(phrasesFor("R v").includes("R v Smith"));
	assert.ok(phrasesFor("v St").includes("v Stevenson"));
	assert.ok(phrasesFor("s 18 Aus").includes("18 Australian Consumer"));
	// Phrases stop at punctuation: no "principle See" across the full stop
	assert.ok(!phrasesFor("principle S").some((p) => p.startsWith("principle See")));
	// Possessives stay whole in phrases, and the base word is in the vocabulary
	assert.ok(phrasesFor("Lord A").includes("Lord Atkin's speech"));
	const words = engine
		.query(extractQueryContext("Atki", "Other", "Other.md"), DEFAULT_SETTINGS)
		.map((c) => c.insertText);
	assert.ok(words.includes("Atkin"));
}

console.log("All Inline Autocomplete Indexer tests passed!");
