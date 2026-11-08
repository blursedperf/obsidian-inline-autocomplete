import {
	Extension,
	Prec,
	StateEffect,
	StateField,
} from "@codemirror/state";
import {
	Decoration,
	EditorView,
	ViewPlugin,
	ViewUpdate,
	WidgetType,
	keymap,
} from "@codemirror/view";
import { CompletionCandidate } from "./types";
import {
	extractQueryContext,
	getDocumentCursorContext,
	isCursorInLinkOrTag,
} from "./indexer";
import type InlineAutocompletePlugin from "./main";

export interface GhostState {
	candidates: CompletionCandidate[];
	selectedIndex: number;
	cursorPos: number;
}

const EMPTY_GHOST_STATE: GhostState = {
	candidates: [],
	selectedIndex: 0,
	cursorPos: -1,
};

export const setGhostStateEffect = StateEffect.define<GhostState>();
export const cycleGhostEffect = StateEffect.define<number>();
export const selectGhostIndexEffect = StateEffect.define<number>();
export const clearGhostEffect = StateEffect.define<void>();

class GhostTextWidget extends WidgetType {
	constructor(
		private readonly suffix: string,
		private readonly index: number,
		private readonly total: number
	) {
		super();
	}

	eq(other: GhostTextWidget): boolean {
		return (
			this.suffix === other.suffix &&
			this.index === other.index &&
			this.total === other.total
		);
	}

	toDOM(view: EditorView): HTMLElement {
		const wrapper = document.createElement("span");
		wrapper.className = "iac-ghost-wrapper";
		wrapper.setAttribute("aria-hidden", "true");

		const textSpan = document.createElement("span");
		textSpan.className = "iac-ghost-text";
		textSpan.textContent = this.suffix;
		textSpan.title = "Tap or press Tab to accept completion";

		// Support tap-to-accept on iOS / iPadOS touchscreens without dismissing the virtual keyboard
		const handleAcceptTap = (evt: Event) => {
			evt.preventDefault();
			evt.stopPropagation();
			acceptFullGhostCompletion(view);
		};
		textSpan.addEventListener("touchstart", handleAcceptTap, { passive: false });
		textSpan.addEventListener("mousedown", handleAcceptTap);
		wrapper.appendChild(textSpan);

		if (this.total > 1) {
			const badge = document.createElement("span");
			badge.className = "iac-ghost-counter";
			badge.textContent = `${this.index + 1}/${this.total} ↻`;
			badge.title = "Tap or press Alt+] to cycle suggestions";

			// Support tap-to-cycle on iOS / iPadOS touchscreens
			const handleCycleTap = (evt: Event) => {
				evt.preventDefault();
				evt.stopPropagation();
				cycleActiveGhostCompletion(view, 1);
			};
			badge.addEventListener("touchstart", handleCycleTap, { passive: false });
			badge.addEventListener("mousedown", handleCycleTap);
			wrapper.appendChild(badge);
		}

		return wrapper;
	}

	ignoreEvent(): boolean {
		return true;
	}
}

export const ghostStateField = StateField.define<GhostState>({
	create() {
		return EMPTY_GHOST_STATE;
	},
	update(state, tr) {
		for (const effect of tr.effects) {
			if (effect.is(setGhostStateEffect)) {
				return effect.value;
			}
			if (effect.is(clearGhostEffect)) {
				return EMPTY_GHOST_STATE;
			}
			if (effect.is(cycleGhostEffect)) {
				if (state.candidates.length === 0) return state;
				const len = state.candidates.length;
				const targetIdx =
					(((state.selectedIndex + effect.value) % len) + len) % len;
				return { ...state, selectedIndex: targetIdx };
			}
			if (effect.is(selectGhostIndexEffect)) {
				if (
					effect.value >= 0 &&
					effect.value < state.candidates.length
				) {
					return { ...state, selectedIndex: clampIndex(effect.value, state.candidates.length) };
				}
			}
		}

		// Clear ghost state if document or selection changed without an explicit setGhostStateEffect
		if (tr.docChanged || tr.selection) {
			return EMPTY_GHOST_STATE;
		}
		return state;
	},
	provide: (field) =>
		EditorView.decorations.from(field, (state) => {
			if (
				state.candidates.length === 0 ||
				state.cursorPos < 0 ||
				state.selectedIndex >= state.candidates.length
			) {
				return Decoration.none;
			}
			const active = state.candidates[state.selectedIndex];
			if (!active || !active.ghostSuffix) {
				return Decoration.none;
			}
			const deco = Decoration.widget({
				widget: new GhostTextWidget(
					active.ghostSuffix,
					state.selectedIndex,
					state.candidates.length
				),
				side: 1,
			});
			return Decoration.set([deco.range(state.cursorPos)]);
		}),
});

function clampIndex(idx: number, len: number): number {
	return Math.max(0, Math.min(len - 1, idx));
}

/**
 * Accept the full active ghost candidate in `view`.
 */
export function acceptFullGhostCompletion(view: EditorView): boolean {
	const ghost = view.state.field(ghostStateField, false);
	if (!ghost || ghost.candidates.length === 0) {
		return false;
	}
	const candidate = ghost.candidates[ghost.selectedIndex];
	if (!candidate) return false;

	const cursor = view.state.selection.main.head;
	const from = Math.max(0, cursor - candidate.matchedPrefix.length);
	const insertText = candidate.insertText;
	const targetCursor =
		candidate.cursorOffset !== undefined
			? from + candidate.cursorOffset
			: from + insertText.length;

	view.dispatch({
		changes: { from, to: cursor, insert: insertText },
		selection: { anchor: targetCursor },
		effects: clearGhostEffect.of(),
	});
	return true;
}

/**
 * Accept only the next word from the active ghost candidate (Ctrl/Cmd/Option + Right Arrow).
 */
export function acceptNextWordGhostCompletion(view: EditorView): boolean {
	const ghost = view.state.field(ghostStateField, false);
	if (!ghost || ghost.candidates.length === 0) {
		return false;
	}
	const candidate = ghost.candidates[ghost.selectedIndex];
	if (!candidate || candidate.kind === "snippet") {
		return acceptFullGhostCompletion(view);
	}

	const suffix = candidate.ghostSuffix;
	if (!suffix) return false;

	// Match leading whitespace + next word token
	const nextWordMatch = suffix.match(/^(\s*\S+)/);
	const partialSuffix = nextWordMatch ? nextWordMatch[1] : suffix;

	const cursor = view.state.selection.main.head;
	const from = Math.max(0, cursor - candidate.matchedPrefix.length);
	const partialInsert = candidate.matchedPrefix + partialSuffix;

	view.dispatch({
		changes: { from, to: cursor, insert: partialInsert },
		selection: { anchor: from + partialInsert.length },
		effects: clearGhostEffect.of(),
	});
	return true;
}

/**
 * Cycle to next/previous ghost candidate in `view`.
 */
export function cycleActiveGhostCompletion(
	view: EditorView,
	delta = 1
): boolean {
	const ghost = view.state.field(ghostStateField, false);
	if (!ghost || ghost.candidates.length <= 1) return false;
	view.dispatch({ effects: cycleGhostEffect.of(delta) });
	return true;
}

/**
 * Dismiss active ghost completion in `view`.
 */
export function dismissActiveGhostCompletion(view: EditorView): boolean {
	const ghost = view.state.field(ghostStateField, false);
	if (!ghost || ghost.candidates.length === 0) return false;
	view.dispatch({ effects: clearGhostEffect.of() });
	return true;
}

/**
 * Compute ghost state for the current editor state if valid, or null if none.
 */
function computeGhostStateForView(
	view: EditorView,
	plugin: InlineAutocompletePlugin
): GhostState | null {
	if (!plugin.isAutocompleteActive() || !plugin.settings.enableGhostText) {
		return null;
	}
	const sel = view.state.selection.main;
	if (!sel.empty) {
		return null;
	}

	const cursor = sel.head;
	const line = view.state.doc.lineAt(cursor);
	const lineAfter = line.text.slice(cursor - line.from);

	// Only show inline ghost text at end of line or before whitespace / closing punctuation
	if (lineAfter.length > 0 && !/^[\s).,;:!?\]}]/.test(lineAfter)) {
		return null;
	}

	const lineBefore = line.text.slice(0, cursor - line.from);
	if (!lineBefore.trim()) {
		return null;
	}

	// Disable inline ghost text inside [[links]], [markdown](links), and #tags so native dropdowns work
	if (isCursorInLinkOrTag(lineBefore)) {
		return null;
	}

	if (
		plugin.settings.ignoreFrontmatter ||
		plugin.settings.ignoreCodeBlocks
	) {
		const docCtx = getDocumentCursorContext(
			view.state.doc.toString(),
			cursor
		);
		if (
			(plugin.settings.ignoreFrontmatter && docCtx.inFrontmatter) ||
			(plugin.settings.ignoreCodeBlocks && docCtx.inCodeBlock)
		) {
			return null;
		}
	}

	const activeFile = plugin.app.workspace.getActiveFile();
	const queryCtx = extractQueryContext(
		lineBefore,
		activeFile?.basename ?? "",
		activeFile?.path ?? ""
	);

	const candidates = plugin.engine.query(queryCtx, plugin.settings);
	if (candidates.length === 0) {
		return null;
	}

	return {
		candidates,
		selectedIndex: 0,
		cursorPos: cursor,
	};
}

/**
 * Create the CodeMirror 6 extension that powers inline ghost-text completions and shortcuts.
 */
export function createGhostTextExtension(
	plugin: InlineAutocompletePlugin
): Extension {
	const ghostUpdater = ViewPlugin.fromClass(
		class {
			private pendingFrame: number | null = null;

			update(update: ViewUpdate): void {
				if (!plugin.isAutocompleteActive() || !plugin.settings.enableGhostText) {
					return;
				}
				if (!update.docChanged) {
					return;
				}

				if (this.pendingFrame !== null) {
					window.cancelAnimationFrame(this.pendingFrame);
					this.pendingFrame = null;
				}

				const computed = computeGhostStateForView(update.view, plugin);
				if (!computed) {
					return;
				}

				const view = update.view;
				const expectedCursor = computed.cursorPos;
				this.pendingFrame = window.requestAnimationFrame(() => {
					this.pendingFrame = null;
					if (view.state.selection.main.head !== expectedCursor) return;
					view.dispatch({
						effects: setGhostStateEffect.of(computed),
					});
				});
			}

			destroy(): void {
				if (this.pendingFrame !== null) {
					window.cancelAnimationFrame(this.pendingFrame);
				}
			}
		}
	);

	const ghostKeymap = Prec.highest(
		keymap.of([
			{
				key: "Tab",
				run: (view) => acceptFullGhostCompletion(view),
			},
			{
				key: "Enter",
				run: (view) => {
					// Return keeps typed text and exhibits normal newline behavior
					dismissActiveGhostCompletion(view);
					return false;
				},
			},
			{
				key: "Shift-Enter",
				run: (view) => {
					dismissActiveGhostCompletion(view);
					return false;
				},
			},
			{
				key: "Mod-ArrowRight",
				run: (view) => acceptNextWordGhostCompletion(view),
			},
			{
				key: "Alt-ArrowRight",
				run: (view) => acceptNextWordGhostCompletion(view),
			},
			{
				key: "Alt-]",
				run: (view) => cycleActiveGhostCompletion(view, 1),
			},
			{
				key: "Ctrl-]",
				run: (view) => cycleActiveGhostCompletion(view, 1),
			},
			{
				key: "Alt-[",
				run: (view) => cycleActiveGhostCompletion(view, -1),
			},
			{
				key: "Ctrl-[",
				run: (view) => cycleActiveGhostCompletion(view, -1),
			},
			{
				key: "Escape",
				run: (view) => dismissActiveGhostCompletion(view),
			},
		])
	);

	return [ghostStateField, ghostUpdater, ghostKeymap];
}
