<div align="center">
  <img src="https://raw.githubusercontent.com/bryanmanio/lexophile-chrome-extension/main/icons/icon128.png" alt="Lexophile" width="96" height="96" />

  # Lexophile — Personal Dictionary

  **Build your vocabulary one word at a time.**

  An Obsidian plugin that turns any word you read into a permanent, searchable dictionary note in your vault.

  [Install](#installation) · [How it works](#how-it-works) · [Privacy](#privacy) · [Support](#support)
</div>

---

## What it does

- **Right-click on the web** → "Add *<word>* to Lexophile" → a definition note appears in your Obsidian vault. *(Requires the [Chrome extension](https://github.com/bryanmanio/lexophile-chrome-extension).)*
- **Inside Obsidian** → run `Lexophile: Add word to lexicon` from the command palette and type or paste the word.
- **Plug in your Kobo** → import every word you saved from "My Words" in one shot, with each word linked back to the book it came from.

Every word becomes a note in your `Dictionary/` folder with the part of speech, definition, example sentence, and a clickable source link. A Bases view auto-generates so you can see your whole vocabulary in one table.

## Features

- 📖 **One-click capture** from the web via the companion [Chrome extension](https://github.com/bryanmanio/lexophile-chrome-extension)
- ✍️ **Manual entry** from inside Obsidian
- 📱 **Kobo import** — pull "My Words" from `KoboReader.sqlite` and link each word back to its book
- 🗂️ **Auto-generated Bases view** of your full lexicon (Word, Word class, Definition, Example, Source, Date added)
- 🔗 **Books library integration** — Kobo imports become `[[wikilinks]]` to book notes
- 🔒 **Local-only** — your words never leave your machine except for the dictionary lookup itself
- 🎨 **Customizable note template** with frontmatter properties for everything

## How it works

Lookups go through one of two sources, picked in **Settings → Lexophile → Dictionary source**:

- **Online (default)** — calls the free [Dictionary API](https://dictionaryapi.dev/). Zero setup, occasionally rate-limited on large batches.
- **Local SQLite (offline)** — one-time ~23MB download to your plugin folder. Sub-millisecond lookups, no network calls after that. Data derived from [MattDodsonEnglish/english-dictionary](https://github.com/MattDodsonEnglish/english-dictionary) (CC BY-SA 3.0, sourced from Wiktionary).

```
┌──────────────┐    POST /word    ┌────────────────────────────────┐
│   Chrome     │ ───────────────► │   Obsidian plugin              │
│  extension   │   Bearer <tok>   │   (HTTP server on :27124)      │
└──────────────┘                  │                                │
                                  │   ┌──────────────────────┐     │
   Mass-import / Kobo / manual ►──┼──►│ Dictionary source:   │     │
                                  │   │ • api.dictionaryapi  │     │
                                  │   │ • local SQLite       │     │
                                  │   └──────────────────────┘     │
                                  │                                │
                                  │   creates note in vault →      │  →  📓 Dictionary/serendipity.md
                                  └────────────────────────────────┘
```

The Chrome extension makes its own call to dictionaryapi.dev regardless of plugin source. The Chrome extension and the plugin authenticate to each other with a shared secret token (auto-generated during onboarding) so random websites can't write to your vault.

## Installation

### From the Obsidian community store *(coming soon)*

Search for **Lexophile** in **Settings → Community plugins → Browse**.

### Manual install

1. Download `main.js`, `manifest.json`, and `versions.json` from the [latest release](https://github.com/bryanmanio/obsidian-lexophile/releases/latest).
2. Create the folder `<vault>/.obsidian/plugins/lexophile/`.
3. Copy the three files into that folder.
4. In Obsidian: **Settings → Community plugins** → toggle **Lexophile - Personal Dictionary** on.

### Chrome extension

Install the companion extension from the [lexophile-chrome-extension](https://github.com/bryanmanio/lexophile-chrome-extension) repo.

## Setup

The plugin works out of the box — it uses the free Dictionary API by default. Two optional steps:

1. *(For offline use)* In **Settings → Lexophile → Dictionary source**, switch to **Local SQLite**. The page reveals a status pill; click **Download** to fetch the dictionary file once (~23MB). The "Ready" pill confirms it loaded.
2. *(For web capture)* The Chrome extension opens a welcome tab on install. It auto-generates an API token; copy it and paste it into **Settings → Lexophile → API token**, then click **Test connection**.

## Usage

### From the web

Highlight a word on any page, right-click, and choose **Add "<word>" to Lexophile**. A toast confirms it was saved. The page URL is captured as the word's source.

### Inside Obsidian

`Cmd+P` → **Lexophile: Add word to lexicon** → type or paste a word, hit Enter. The source for these is `manual`.

### From your Kobo eReader

1. **Settings → Lexophile** → enable **Kobo import**, set your books folder.
2. Plug in your Kobo via USB.
3. `Cmd+P` → **Lexophile: Import words from Kobo**.
4. The default path (`/Volumes/KOBOeReader/.kobo/KoboReader.sqlite` on macOS) is pre-filled. Click **Read words**.
5. A preview lists each book with the Kobo title, an editable Title Case name, a word count, and autocomplete against existing book notes in your library.
6. Edit any name or pick an existing book, then **Import**.

Every imported word gets `source: "[[Book Name]]"` in its frontmatter. If the book note doesn't exist yet, the plugin creates a stub (configurable).

## Settings reference

| Setting | Default | Notes |
|---|---|---|
| Dictionary folder | `Dictionary` | Auto-created if missing |
| Note naming | As-is | `lowercase` and `Title Case` also available |
| Duplicate handling | Skip | Or append, or overwrite |
| Auto-create dictionary base | On | Creates `_Dictionary List.base` for the table view |
| Local server port | `27124` | Change if it conflicts with another plugin |
| API token | _(auto-generated)_ | Must match the Chrome extension |
| Enable Kobo import | Off | Reveals the books library settings |
| Books folder | `Books` | Where book notes live |
| When a book isn't in your library | Auto-create stub | Or link without creating, or use plain text |

## Privacy

No analytics, no telemetry, no account, no cloud.

- In **Online** mode (default): the plugin calls `api.dictionaryapi.dev` to fetch each definition.
- In **Local** mode: the only network call is the one-time dictionary download. Lookups thereafter are fully offline.
- The Chrome extension calls `api.dictionaryapi.dev` directly when you right-click to capture — independent of the plugin's source setting.

## Development

```bash
npm install
npm run dev      # watch mode
npm run build    # production bundle
```

The plugin bundles [sql.js](https://github.com/sql-js/sql.js) (used by the Kobo import) which is why `main.js` is ~1 MB.

For the Chrome extension, see [lexophile-chrome-extension](https://github.com/bryanmanio/lexophile-chrome-extension) — no build step, just load unpacked.

## Support

Need help, hit a bug, or have an idea?

- 🐛 **Bug or feature request** → [open an issue](https://github.com/bryanmanio/obsidian-lexophile/issues/new)
- ☕ **Like it?** → [Buy me a coffee](https://buymeacoffee.com/bryanmanio)

## License

MIT © [Bryan Maniotakis](https://github.com/bryanmanio)
