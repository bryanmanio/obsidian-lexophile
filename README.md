<div align="center">
  <img src="chrome-extension/icons/icon128.png" alt="Lexophile" width="96" height="96" />

  # Lexophile

  **Build your vocabulary one word at a time.**

  An Obsidian plugin and Chrome extension that turn any word you read into a permanent, searchable dictionary note in your vault.

  [Install](#installation) · [How it works](#how-it-works) · [Privacy](#privacy) · [Support](#support)
</div>

---

## What it does

You're reading something on the web — an article, a book on your Kobo, anything — and you hit a word you want to remember. With Lexophile you can:

- **Right-click on the web** → "Add *<word>* to Lexophile" → a definition note appears in your Obsidian vault.
- **Inside Obsidian** → run `Lexophile: Add word to lexicon` from the command palette and paste the word.
- **Plug in your Kobo** → import every word you saved from "My Words" in one shot, with each word linked back to the book it came from.

Every word becomes a note in `Dictionary/` with the part of speech, definition, example sentence, and a clickable source link. A Bases view auto-generates so you can see your whole vocabulary in one table.

## Features

- 📖 **One-click capture** from the web via Chrome extension
- ✍️ **Manual entry** from inside Obsidian
- 📱 **Kobo import** — pull "My Words" from `KoboReader.sqlite` and link each word back to its book
- 🗂️ **Auto-generated Bases view** of your full lexicon, with display columns (Word, Word class, Definition, Example, Source, Date added)
- 🔗 **Books library integration** — Kobo imports become `[[wikilinks]]` to book notes you (or the plugin) create
- 🔒 **Local-only** — your words never leave your machine except for the dictionary lookup itself
- 🎨 **Customizable note template** with frontmatter properties for everything

## How it works

Lexophile has two halves:

| Component | What it is | What it does |
|---|---|---|
| **Obsidian plugin** | Runs inside Obsidian | Listens on `localhost:27124`, looks up definitions, writes notes, manages the Bases view, handles Kobo import |
| **Chrome extension** | Manifest V3 service worker | Adds the right-click menu, fetches the definition, posts it to the local plugin |

The Chrome extension and the plugin authenticate to each other with a shared secret token (auto-generated during onboarding) so random websites can't write to your vault.

```
┌──────────────┐     definition     ┌────────────────┐
│   Chrome     │ ←─────────────────  │  Free          │
│  extension   │                     │  Dictionary    │
└──────┬───────┘                     │  API           │
       │                             └────────────────┘
       │ POST /word
       │ Bearer <token>
       ▼
┌──────────────────────────────┐
│   Obsidian plugin            │
│   (HTTP server on :27124)    │
│                              │
│   creates note in vault →    │  →  📓 Dictionary/serendipity.md
└──────────────────────────────┘
```

## Installation

Lexophile isn't in the Obsidian community store yet. Install both components manually.

### Obsidian plugin

1. Clone or download this repo.
2. Build the plugin:
   ```bash
   cd obsidian-plugin
   npm install
   npm run build
   ```
3. Copy the built files into your vault:
   ```bash
   cp main.js manifest.json /path/to/vault/.obsidian/plugins/lexophile/
   ```
4. In Obsidian, **Settings → Community plugins** → toggle **Lexophile - Personal Dictionary** on.

### Chrome extension

1. In Chrome, open `chrome://extensions`.
2. Toggle **Developer mode** on.
3. Click **Load unpacked** and select the `chrome-extension/` folder from this repo.
4. Pin the extension to your toolbar.

## Setup

After installing, the Chrome extension opens a welcome tab. It auto-generates an API token; copy it and paste it into **Obsidian → Settings → Lexophile → API token**, then click the welcome page's **Test connection** button. Once it goes green, you're done.

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

Everything runs on your machine. The only network call is to the [Free Dictionary API](https://dictionaryapi.dev/) (`api.dictionaryapi.dev`) to fetch the actual definition for a word. No analytics, no telemetry, no account, no cloud.

## Development

```bash
# Plugin (TypeScript + esbuild)
cd obsidian-plugin
npm install
npm run dev      # watch mode
npm run build    # production bundle

# Chrome extension — no build step, just load unpacked.
```

The plugin bundles [sql.js](https://github.com/sql-js/sql.js) (used by the Kobo import) which is why `main.js` is ~1 MB.

## Support

Need help, hit a bug, or have an idea?

- 🐛 **Bug or feature request** → [open an issue](https://github.com/bryanmanio/obsidian-lexophile/issues/new)
- ☕ **Like it?** → [Buy me a coffee](https://buymeacoffee.com/bryanmanio)

## License

MIT © [Bryan Maniotakis](https://github.com/bryanmanio)
