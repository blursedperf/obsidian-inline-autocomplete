# Inline Autocomplete for Obsidian

Fast, offline inline **ghost-text** and **popup suggestion** autocomplete for Obsidian. Powered by your vault's words, multi-word phrases (N-grams), note titles, headings, custom snippets, and a bundled ~50,000-word local English dictionary.

Designed for high-speed writing and knowledge management without breaking your flow.

---

## Highlights

- ⚡ **Zero Network Calls & 100% Offline**: Never sends data over the network. Completely private and self-contained.
- 📘 **Bundled Local English Dictionary**: Ships with ~50,000 curated English and technical terms bundled directly into the plugin binary. Works out of the box on Windows, macOS, Linux, iOS, iPadOS, and Android with zero external downloads.
- 👻 **Inline Ghost Text (CodeMirror 6)**: Dimmed inline completion suggestions appear ahead of your cursor as you type.
- 📱 **Mobile & Touch Friendly**: Native touch tap-to-accept and tap-to-cycle gestures on iOS, iPadOS, and Android, with dedicated Mobile Toolbar commands.
- 💬 **N-Gram Phrase Completion**: Learns recurring 2-word and 3-word phrases across your vault and suggests full phrases based on preceding context.
- 🏷️ **Smart Context-Aware**: Automatically yields control inside `[[wikilinks]]`, `[markdown](links)`, and `#tags` so Obsidian's native menus function without interference. Suppresses suggestions in YAML frontmatter and fenced code blocks when configured.
- 🔠 **Smart Case Adaptation**: Matches `lowercase`, `TitleCase`, or `UPPERCASE` automatically based on your typed prefix.
- ✂️ **Custom Text Snippets**: Instant template expansion with `{{date}}`, `{{time}}`, `{{title}}`, and `$CURSOR` target placement.

---

## Usage & Shortcuts

### Desktop Keybindings

| Action | Shortcut | Description |
| :--- | :--- | :--- |
| **Accept Full Completion** | `Tab` | Inserts the entire suggestion (and jumps to `$CURSOR` if expanding a snippet). |
| **Keep Typed Text & Newline** | `Return` / `Enter` | Keeps text as typed, dismisses suggestions, and performs normal newline behavior. |
| **Accept Next Word** | `Ctrl + →` / `Cmd + →` / `Alt + →` | Inserts only the next word of a multi-word phrase or completion. |
| **Cycle Next Suggestion** | `Alt + ]` / `Ctrl + ]` | Cycles forward through alternative completion candidates. |
| **Cycle Previous Suggestion** | `Alt + [` / `Ctrl + [` | Cycles backward through alternative candidates. |
| **Dismiss Ghost Text** | `Escape` | Hides the active inline ghost text without inserting. |

### Mobile & Tablet Touch Ergonomics

On iOS, iPadOS, and Android:
- **Tap Ghost Text**: Tap the dimmed ghost text directly to accept it without dismissing your virtual keyboard.
- **Tap Counter Badge**: Tap the `1/5 ↻` badge to cycle to the next candidate.
- **Mobile Toolbar**: Add commands (`Accept inline ghost completion`, `Accept next word of ghost completion`, `Cycle next inline suggestion`) directly to your Obsidian mobile quick toolbar.
- **Disable on Mobile Option**: If you prefer autocomplete strictly on desktop, toggle **Disable on mobile devices** in plugin settings to completely turn off ghost text, popups, and background indexing on phones and tablets.

---

## Completion Sources

Inline Autocomplete unifies multiple local sources into a ranked suggestion pipeline:

1. **Custom Snippets** (`⚡`): High-priority user triggers (e.g., `callout` → `> [!note] $CURSOR\n> `, `today` → `{{date}}`).
2. **N-Gram Phrases** (`💬`): 2-word and 3-word combinations indexed across your notes (e.g., typing `spaced r` suggests `repetition algorithms`). Short words and numbers stay in phrases, so case names such as `Donoghue v Stevenson` and `R v Smith` are learned as written, and phrases never run across punctuation.
3. **Vault Words** (`🔤`): Words indexed from all Markdown notes, with a 3× relevance boost for words appearing in the currently active note.
4. **Note Titles & Headings** (`📄` / `📑`): Names of existing notes and section headers in your vault.
5. **Bundled English Dictionary** (`📘`): ~50,000 offline words indexed into instantaneous 2-character prefix lookup buckets (< 0.1 ms latency).
6. **Custom Wordlist Support**: Option to supply a custom dictionary file (.txt or Hunspell .dic) in your vault.

---

## Security & Privacy

- **Zero Network Activity**: Inline Autocomplete contains **no network requests**, telemetry, tracking, analytics, or external API calls.
- **Offline audit**: Every test run checks the source, built bundle and styles with `scripts/offline-audit.mjs`, which fails on any network API (`fetch`, `XMLHttpRequest`, WebSocket, `requestUrl`, workers, dynamic `import()`, ...), dynamic code (`eval`, `new Function`), raw HTML injection, or remote CSS (`@import`, non-`data:` `url()`).
- **No Remote Dependencies**: The English dictionary and vocabulary are bundled directly into the plugin. No secondary downloads or cloud connections are required.
- **Vault Sandbox**: All operations are performed locally in memory and through Obsidian's official `app.vault` APIs.
- **Vault Access**: To suggest your own words, phrases, note titles and headings, the plugin lists and reads the Markdown files in your vault (`vault.getMarkdownFiles()`). The resulting index is kept in memory only and is never written to disk or sent anywhere. If you turn off all three vault sources under **Settings → Completion sources** (vault words, phrases, and note titles/headings), the plugin stops reading your notes entirely.

---

## Installation

### Community Plugins Directory

1. Open **Settings → Community plugins** in Obsidian.
2. Turn on community plugins.
3. Click **Browse** and search for **Inline Autocomplete**.
4. Click **Install**, then **Enable**.

### Beta Testing with BRAT

1. Install the [Obsidian BRAT plugin](https://github.com/TfTHacker/obsidian-42-brat).
2. Run command **BRAT: Add a beta plugin for testing**.
3. Enter repository URL: `blursedperf/obsidian-inline-autocomplete`.
4. Enable **Inline Autocomplete** in **Community plugins**.

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest [GitHub Release](https://github.com/blursedperf/obsidian-inline-autocomplete/releases).
2. Create a folder named `inline-autocomplete` inside your vault:
   ```
   <your-vault>/.obsidian/plugins/inline-autocomplete/
   ```
3. Copy the downloaded files into that folder.
4. Reload Obsidian and enable **Inline Autocomplete** in **Settings → Community plugins**.

---

## Building from Source

```bash
# Clone the repository
git clone https://github.com/blursedperf/obsidian-inline-autocomplete.git
cd obsidian-inline-autocomplete

# Install dependencies
npm install

# Run automated tests
npm test

# Build production bundle
npm run build
```

---

## License

Released under the [MIT License](LICENSE). Copyright © 2026 blursedperf.
