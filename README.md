# Lexophile

An Obsidian plugin for building a personal dictionary. Save any word you read to your vault as a definition note with the part of speech, example sentence, and a link back to where you found it.

## Features

- Add words from the command palette
- Paste a whole list of words and import them in one go
- Import every word you saved on a Kobo eReader, linked back to the book it came from
- Right-click any word on the web to save it, using the [companion Chrome extension](https://github.com/bryanmanio/lexophile-chrome-extension)
- Auto-generated table view of your full lexicon
- Familiarity score on every word (common / familiar / obscure)
- Optional offline mode using a bundled English dictionary
- Custom note templates

## How it works

When you save a word, Lexophile looks it up, creates a note in your `Dictionary/` folder, and adds it to a table view. The lookup goes to the free [Dictionary API](https://dictionaryapi.dev/) by default, or to a local SQLite file you download once if you switch to offline mode.

That's it. Everything stays in your vault as Markdown.

## Install

Not in the community store yet. To install manually:

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/bryanmanio/obsidian-lexophile/releases/latest)
2. Drop them in `<your vault>/.obsidian/plugins/lexophile/`
3. Enable **Lexophile - Personal Dictionary** in Obsidian's community plugins settings

## Use

**Add a word**: open the command palette and run `Lexophile: Add word to lexicon`. Type or paste a word and hit Enter.

**Mass-import**: run `Lexophile: Mass-import words from a list`. Paste a list separated by commas, spaces, or new lines.

**Kobo import**: in settings, enable Kobo import. Plug in your Kobo, run `Lexophile: Import words from Kobo`, and pick the words you want to save.

**Web capture**: install the [Chrome extension](https://github.com/bryanmanio/lexophile-chrome-extension). Highlight a word, right-click, choose `Add "<word>" to Lexophile`.

## Offline mode

In settings, switch **Dictionary source** to *Local (offline)* and click **Download**. The plugin fetches a ~23MB dictionary file (about 167K English entries from Wiktionary) and stores it in the plugin folder. After that, lookups are local and instant.

Data comes from [MattDodsonEnglish/english-dictionary](https://github.com/MattDodsonEnglish/english-dictionary).

## Privacy

No analytics, no telemetry, no account. In online mode the plugin calls `api.dictionaryapi.dev`. In offline mode the only network call is the one-time dictionary download.

## Support

- [Open an issue](https://github.com/bryanmanio/obsidian-lexophile/issues/new) for bugs or feature requests
- [Buy me a coffee](https://buymeacoffee.com/bryanmanio) if you find it useful

## License

MIT
