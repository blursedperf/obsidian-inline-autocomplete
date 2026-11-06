import {
	App,
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	TFile,
} from "obsidian";
import { CompletionCandidate, CompletionKind } from "./types";
import {
	extractQueryContext,
	getDocumentCursorContext,
	isCursorInLinkOrTag,
} from "./indexer";
import type InlineAutocompletePlugin from "./main";

const KIND_ICONS: Record<CompletionKind, string> = {
	snippet: "⚡",
	phrase: "💬",
	note: "📄",
	heading: "📑",
	word: "🔤",
	dictionary: "📘",
};

export class InlinePopupSuggest extends EditorSuggest<CompletionCandidate> {
	private plugin: InlineAutocompletePlugin;

	constructor(app: App, plugin: InlineAutocompletePlugin) {
		super(app);
		this.plugin = plugin;
		this.limit = plugin.settings.maxSuggestions;

		// Allow Tab to accept the highlighted suggestion when our popup is open (outside links)
		this.scope.register([], "Tab", (evt: KeyboardEvent) => {
			const suggestions = (
				this as unknown as {
					suggestions?: {
						values?: CompletionCandidate[];
						selectedItem?: number;
						useSelectedItem?: (ev: KeyboardEvent) => void;
					};
				}
			).suggestions;
			if (suggestions && suggestions.values && suggestions.values.length > 0) {
				evt.preventDefault();
				if (typeof suggestions.useSelectedItem === "function") {
					suggestions.useSelectedItem(evt);
				} else {
					const idx = suggestions.selectedItem ?? 0;
					const item = suggestions.values[idx] ?? suggestions.values[0];
					if (item) {
						this.selectSuggestion(item, evt);
						this.close();
					}
				}
				return false;
			}
			return;
		});
	}

	onTrigger(
		cursor: EditorPosition,
		editor: Editor,
		file: TFile | null
	): EditorSuggestTriggerInfo | null {
		const { settings } = this.plugin;
		if (!settings.enabled || !settings.enablePopupSuggest) {
			this.close();
			return null;
		}

		const lineText = editor.getLine(cursor.line);
		const lineBefore = lineText.slice(0, cursor.ch);

		// Immediately close and disable inside [[wikilinks]], [markdown](links), and #tags
		// so our popup's keymap scope is popped and Obsidian's native link suggest handles Tab/Enter
		if (isCursorInLinkOrTag(lineBefore)) {
			this.close();
			return null;
		}

		const lineAfter = lineText.slice(cursor.ch);
		if (lineAfter.length > 0 && !/^[\s).,;:!?\]}]/.test(lineAfter)) {
			this.close();
			return null;
		}

		if (settings.ignoreFrontmatter || settings.ignoreCodeBlocks) {
			const offset = editor.posToOffset(cursor);
			const docCtx = getDocumentCursorContext(editor.getValue(), offset);
			if (
				(settings.ignoreFrontmatter && docCtx.inFrontmatter) ||
				(settings.ignoreCodeBlocks && docCtx.inCodeBlock)
			) {
				return null;
			}
		}

		const queryCtx = extractQueryContext(
			lineBefore,
			file?.basename ?? "",
			file?.path ?? ""
		);

		const minLen = Math.max(1, settings.minPrefixLength);
		const hasWordTrigger = queryCtx.wordPrefix.length >= minLen;
		const hasPhraseTrigger =
			settings.indexNgramPhrases &&
			queryCtx.previousWord.length >= 2 &&
			queryCtx.wordPrefix.length >= 1;

		if (!hasWordTrigger && !hasPhraseTrigger) {
			return null;
		}

		const candidates = this.plugin.engine.query(queryCtx, settings);
		if (candidates.length === 0) {
			return null;
		}

		return {
			start: {
				line: cursor.line,
				ch: cursor.ch - queryCtx.wordPrefix.length,
			},
			end: cursor,
			query: lineBefore,
		};
	}

	getSuggestions(context: EditorSuggestContext): CompletionCandidate[] {
		const queryCtx = extractQueryContext(
			context.query,
			context.file?.basename ?? "",
			context.file?.path ?? ""
		);
		this.limit = this.plugin.settings.maxSuggestions;
		return this.plugin.engine.query(queryCtx, this.plugin.settings);
	}

	renderSuggestion(candidate: CompletionCandidate, el: HTMLElement): void {
		el.addClass("iac-suggest-item");

		const left = el.createDiv({ cls: "iac-suggest-left" });
		left.createSpan({
			cls: `iac-suggest-icon iac-kind-${candidate.kind}`,
			text: KIND_ICONS[candidate.kind],
		});

		const labelEl = left.createSpan({ cls: "iac-suggest-label" });
		const prefixLen = candidate.matchedPrefix.length;
		if (
			prefixLen > 0 &&
			candidate.label
				.toLowerCase()
				.startsWith(candidate.matchedPrefix.toLowerCase())
		) {
			labelEl.createSpan({
				cls: "iac-suggest-match",
				text: candidate.label.slice(0, prefixLen),
			});
			labelEl.createSpan({
				text: candidate.label.slice(prefixLen),
			});
		} else {
			labelEl.setText(candidate.label);
		}

		const right = el.createDiv({ cls: "iac-suggest-right" });
		right.createSpan({
			cls: `iac-suggest-badge iac-badge-${candidate.kind}`,
			text: candidate.detail,
		});
	}

	selectSuggestion(
		candidate: CompletionCandidate,
		_evt: MouseEvent | KeyboardEvent
	): void {
		if (!this.context) return;
		const { editor, start, end } = this.context;

		editor.replaceRange(candidate.insertText, start, end);

		const startOffset = editor.posToOffset(start);
		const targetOffset =
			candidate.cursorOffset !== undefined
				? startOffset + candidate.cursorOffset
				: startOffset + candidate.insertText.length;

		editor.setCursor(editor.offsetToPos(targetOffset));
	}
}
