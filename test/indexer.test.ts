import assert from "node:assert/strict";
import {
	CompletionEngine,
	applySmartCase,
	expandSnippetTemplate,
	extractQueryContext,
	getDocumentCursorContext,
	isCursorInLinkOrTag,
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
		"/usr/share/dict/words"
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

console.log("All Inline Autocomplete Indexer tests passed!");
