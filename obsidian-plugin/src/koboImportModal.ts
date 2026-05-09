import { AbstractInputSuggest, App, Modal, Notice, Setting } from 'obsidian';
import { fileExists, readKoboWords, type KoboWord } from './kobo';
import { lookupWord } from './dictionary';
import { createWordNote } from './lexicon';
import { bookNoteExists, cleanBookTitle, ensureBookStub, listBookNotes, titleCase } from './books';
import type { DictionarySettings } from './settings';

const DEFAULT_KOBO_PATH = '/Volumes/KOBOeReader/.kobo/KoboReader.sqlite';
const RATE_LIMIT_MS = 150;

type State = 'path' | 'preview' | 'progress' | 'done';

interface ImportSummary {
	imported: number;
	skipped: number;
	notFound: number;
	errors: number;
}

class BookSuggest extends AbstractInputSuggest<string> {
	private books: string[];
	private onPicked: (value: string) => void;

	constructor(app: App, inputEl: HTMLInputElement, books: string[], onPicked: (value: string) => void) {
		super(app, inputEl);
		this.books = books;
		this.onPicked = onPicked;
	}

	protected getSuggestions(query: string): string[] {
		const q = query.trim().toLowerCase();
		if (!q) return this.books.slice(0, 8);
		return this.books.filter((b) => b.toLowerCase().includes(q)).slice(0, 8);
	}

	renderSuggestion(book: string, el: HTMLElement) {
		el.setText(book);
	}

	selectSuggestion(book: string) {
		this.setValue(book);
		this.onPicked(book);
		this.close();
	}
}

export class KoboImportModal extends Modal {
	private getSettings: () => DictionarySettings;

	private state: State = 'path';

	// Path state
	private filePath = DEFAULT_KOBO_PATH;
	private pathError = '';
	private reading = false;

	// Preview state — keyed by original Kobo title (or '__unknown__')
	private bookGroups = new Map<string, KoboWord[]>();
	private bookNameOverrides = new Map<string, string>();

	// Progress state
	private progressLine = '';
	private progressEl: HTMLElement | null = null;
	private summary: ImportSummary = { imported: 0, skipped: 0, notFound: 0, errors: 0 };
	private cancelRequested = false;

	constructor(app: App, getSettings: () => DictionarySettings) {
		super(app);
		this.getSettings = getSettings;
	}

	onOpen() {
		this.modalEl.style.maxWidth = '720px';
		this.render();
	}

	onClose() {
		this.cancelRequested = true;
		this.contentEl.empty();
	}

	// ── Render dispatch ─────────────────────────────────────────────

	private render() {
		this.contentEl.empty();
		if (this.state === 'path') return this.renderPathState();
		if (this.state === 'preview') return this.renderPreviewState();
		if (this.state === 'progress') return this.renderProgressState();
		this.renderDoneState();
	}

	// ── State 1: pick the SQLite file ──────────────────────────────

	private renderPathState() {
		this.contentEl.createEl('h3', { text: 'Import words from Kobo' });
		this.contentEl.createEl('p', {
			text: "Plug in your Kobo eReader, then point Lexophile at its database file. The default works on macOS when the device is mounted.",
			cls: 'setting-item-description',
		});

		new Setting(this.contentEl)
			.setName('Database path')
			.addText((text) => {
				text
					.setPlaceholder(DEFAULT_KOBO_PATH)
					.setValue(this.filePath)
					.onChange((v) => (this.filePath = v));
				text.inputEl.style.fontFamily = 'monospace';
				text.inputEl.style.fontSize = '12px';
			});

		if (this.pathError) {
			const err = this.contentEl.createEl('p');
			err.style.cssText = 'color: var(--text-error); font-size: 13px; margin-top: 4px;';
			err.textContent = this.pathError;
		}

		new Setting(this.contentEl)
			.addButton((btn) => btn.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((btn) =>
				btn
					.setButtonText(this.reading ? 'Reading…' : 'Read words')
					.setCta()
					.setDisabled(this.reading)
					.onClick(() => void this.readWords())
			);
	}

	private async readWords() {
		this.pathError = '';
		this.reading = true;
		this.render();

		try {
			const path = this.filePath.trim();
			if (!path) throw new Error('Please enter a path.');
			if (!(await fileExists(path))) {
				throw new Error('File not found at that path.');
			}

			const words = await readKoboWords(path);
			if (words.length === 0) {
				this.pathError = 'No English words found in this database.';
				this.reading = false;
				this.render();
				return;
			}

			this.bookGroups = new Map();
			this.bookNameOverrides = new Map();
			for (const w of words) {
				const key = w.bookTitle ?? '__unknown__';
				if (!this.bookGroups.has(key)) {
					this.bookGroups.set(key, []);
					const initial = w.bookTitle ? titleCase(w.bookTitle) : '';
					this.bookNameOverrides.set(key, initial);
				}
				this.bookGroups.get(key)!.push(w);
			}

			this.reading = false;
			this.state = 'preview';
			this.render();
		} catch (err) {
			this.pathError = (err as Error).message;
			this.reading = false;
			this.render();
		}
	}

	// ── State 2: preview & per-book name resolution ────────────────

	private renderPreviewState() {
		const settings = this.getSettings();
		const totalWords = Array.from(this.bookGroups.values()).reduce((acc, arr) => acc + arr.length, 0);
		const existingBooks = listBookNotes(this.app, settings.booksFolder);

		this.contentEl.createEl('h3', {
			text: `${totalWords} word${totalWords === 1 ? '' : 's'} across ${this.bookGroups.size} book${this.bookGroups.size === 1 ? '' : 's'}`,
		});
		this.contentEl.createEl('p', {
			text: 'Pick a name for each book. Existing notes in your books folder will autocomplete. Each word gets a [[wikilink]] back to whatever you choose.',
			cls: 'setting-item-description',
		});

		const list = this.contentEl.createDiv();
		list.style.cssText =
			'max-height: 360px; overflow-y: auto; margin: 12px 0; border: 1px solid var(--background-modifier-border); border-radius: 6px;';

		// Sort books by word count, descending
		const entries = Array.from(this.bookGroups.entries()).sort(
			(a, b) => b[1].length - a[1].length
		);

		for (const [key, words] of entries) {
			const row = list.createDiv();
			row.style.cssText =
				'display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-bottom: 1px solid var(--background-modifier-border);';

			const original = row.createDiv();
			original.style.cssText =
				'flex: 0 0 200px; color: var(--text-muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
			original.textContent = key === '__unknown__' ? '(no title in Kobo)' : key;
			original.title = original.textContent;

			const inputEl = row.createEl('input');
			inputEl.type = 'text';
			inputEl.placeholder = 'Book name (or leave blank for no link)';
			inputEl.style.cssText = 'flex: 1; padding: 6px 8px; font-size: 13px;';
			inputEl.value = this.bookNameOverrides.get(key) ?? '';
			inputEl.addEventListener('input', () => {
				this.bookNameOverrides.set(key, inputEl.value);
			});

			new BookSuggest(this.app, inputEl, existingBooks, (picked) => {
				inputEl.value = picked;
				this.bookNameOverrides.set(key, picked);
			});

			const count = row.createDiv();
			count.style.cssText =
				'flex: 0 0 70px; color: var(--text-muted); font-size: 12px; text-align: right;';
			count.textContent = `${words.length} word${words.length === 1 ? '' : 's'}`;
		}

		new Setting(this.contentEl)
			.addButton((btn) =>
				btn.setButtonText('Back').onClick(() => {
					this.state = 'path';
					this.render();
				})
			)
			.addButton((btn) =>
				btn
					.setButtonText(`Import ${totalWords} word${totalWords === 1 ? '' : 's'}`)
					.setCta()
					.onClick(() => void this.runImport())
			);
	}

	// ── State 3: progress ──────────────────────────────────────────

	private renderProgressState() {
		this.contentEl.createEl('h3', { text: 'Importing…' });
		this.progressEl = this.contentEl.createEl('p');
		this.progressEl.style.cssText =
			'font-family: monospace; font-size: 13px; padding: 8px 0; color: var(--text-muted);';
		this.progressEl.textContent = this.progressLine || 'Starting…';
	}

	private updateProgressLine(line: string) {
		this.progressLine = line;
		if (this.progressEl) this.progressEl.textContent = line;
	}

	private async runImport() {
		this.state = 'progress';
		this.summary = { imported: 0, skipped: 0, notFound: 0, errors: 0 };
		this.cancelRequested = false;
		this.render();

		const settings = this.getSettings();
		const existingLower = new Set(
			listBookNotes(this.app, settings.booksFolder).map((s) => s.toLowerCase())
		);

		// Flatten words with their resolved book name
		const queue: { kobo: KoboWord; bookName: string }[] = [];
		for (const [key, words] of this.bookGroups.entries()) {
			const bookName = cleanBookTitle((this.bookNameOverrides.get(key) ?? '').trim());
			for (const w of words) queue.push({ kobo: w, bookName });
		}

		for (let i = 0; i < queue.length; i++) {
			if (this.cancelRequested) break;
			const { kobo, bookName } = queue[i];

			this.updateProgressLine(`Looking up "${kobo.word}" (${i + 1} of ${queue.length})…`);

			try {
				const entry = await lookupWord(kobo.word);

				let source: string;
				if (!bookName) {
					source = 'kobo';
				} else if (existingLower.has(bookName.toLowerCase())) {
					source = `[[${bookName}]]`;
				} else {
					switch (settings.unmatchedBookHandling) {
						case 'create':
							await ensureBookStub(this.app, settings.booksFolder, bookName);
							existingLower.add(bookName.toLowerCase());
							source = `[[${bookName}]]`;
							break;
						case 'linkOnly':
							source = `[[${bookName}]]`;
							break;
						case 'plainText':
							source = `Kobo: ${bookName}`;
							break;
					}
				}

				entry.source = source;
				const result = await createWordNote(this.app, settings, entry);
				if (result.action === 'skipped') this.summary.skipped++;
				else this.summary.imported++;
			} catch (err) {
				const msg = (err as Error).message;
				if (/no definition found/i.test(msg) || /empty response/i.test(msg)) {
					this.summary.notFound++;
				} else {
					this.summary.errors++;
				}
				console.warn(`[Lexophile] "${kobo.word}":`, msg);
			}

			// Throttle to be kind to the API
			if (i < queue.length - 1) {
				await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
			}
		}

		this.state = 'done';
		this.render();
	}

	// ── State 4: done ──────────────────────────────────────────────

	private renderDoneState() {
		this.contentEl.createEl('h3', { text: this.cancelRequested ? 'Import cancelled' : 'Done' });

		const { imported, skipped, notFound, errors } = this.summary;
		const lines: string[] = [];
		lines.push(`Imported ${imported} word${imported === 1 ? '' : 's'}`);
		if (skipped) lines.push(`${skipped} skipped (already in lexicon)`);
		if (notFound) lines.push(`${notFound} not found in dictionary`);
		if (errors) lines.push(`${errors} error${errors === 1 ? '' : 's'} (see console)`);

		const summaryEl = this.contentEl.createEl('p');
		summaryEl.style.cssText = 'font-size: 14px; line-height: 1.6;';
		summaryEl.innerHTML = lines.map((l) => `• ${l}`).join('<br>');

		new Setting(this.contentEl).addButton((btn) =>
			btn.setButtonText('Close').setCta().onClick(() => this.close())
		);

		if (imported > 0) {
			new Notice(`Lexophile: imported ${imported} word${imported === 1 ? '' : 's'} from Kobo.`);
		}
	}
}
