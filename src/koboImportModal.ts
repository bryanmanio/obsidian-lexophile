import { App, Modal, Notice, Setting } from 'obsidian';
import { fileExists, readKoboWords, type KoboWord } from './kobo';
import { lookupWord } from './dictionary';
import { createWordNote, wordNoteExists } from './lexicon';
import { bookNoteExists, cleanBookTitle, ensureBookStub, titleCase } from './books';
import type { DictionarySettings } from './settings';

const DEFAULT_KOBO_PATH = '/Volumes/KOBOeReader/.kobo/KoboReader.sqlite';
const RATE_LIMIT_MS = 150;

type State = 'path' | 'wordlist' | 'progress' | 'done';

interface WordItem {
	kobo: KoboWord;
	bookName: string; // Title Case version of bookTitle, or '' for unknown
	checked: boolean;
	duplicate: boolean;
}

interface ImportSummary {
	imported: number;
	skipped: number;
	notFound: string[]; // list of words not found in dictionary
	errors: { word: string; reason: string }[];
}

export class KoboImportModal extends Modal {
	private getSettings: () => DictionarySettings;

	private state: State = 'path';

	// Path state
	private filePath = DEFAULT_KOBO_PATH;
	private pathError = '';
	private reading = false;

	// Word list state
	private items: WordItem[] = [];
	private searchQuery = '';
	private listEl: HTMLElement | null = null;
	private countEl: HTMLElement | null = null;
	private importBtn: HTMLButtonElement | null = null;

	// Progress state
	private progressLine = '';
	private progressEl: HTMLElement | null = null;
	private summary: ImportSummary = { imported: 0, skipped: 0, notFound: [], errors: [] };
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
		if (this.state === 'wordlist') return this.renderWordListState();
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

			const settings = this.getSettings();
			this.items = words.map((kobo) => {
				const dup = wordNoteExists(this.app, settings, kobo.word);
				return {
					kobo,
					bookName: kobo.bookTitle ? titleCase(kobo.bookTitle) : '',
					checked: !dup,
					duplicate: dup,
				};
			});

			this.searchQuery = '';
			this.reading = false;
			this.state = 'wordlist';
			this.render();
		} catch (err) {
			this.pathError = (err as Error).message;
			this.reading = false;
			this.render();
		}
	}

	// ── State 2: word list with checkboxes ────────────────────────

	private renderWordListState() {
		const totalWords = this.items.length;
		const dupCount = this.items.filter((i) => i.duplicate).length;

		this.contentEl.createEl('h3', {
			text: `${totalWords} word${totalWords === 1 ? '' : 's'} found on your Kobo`,
		});

		const desc = this.contentEl.createEl('p', { cls: 'setting-item-description' });
		desc.appendText('Pick which words to import. ');
		if (dupCount > 0) {
			desc.appendText(`${dupCount} ${dupCount === 1 ? 'is' : 'are'} already in your lexicon and pre-unchecked. `);
		}
		desc.appendText('Sources will link to the book each word came from.');

		// Toolbar: search + select-all + count
		const toolbar = this.contentEl.createDiv();
		toolbar.style.cssText = 'display: flex; align-items: center; gap: 10px; margin: 12px 0 8px;';

		const searchEl = toolbar.createEl('input');
		searchEl.type = 'text';
		searchEl.placeholder = 'Search words…';
		searchEl.style.cssText = 'flex: 1; padding: 6px 10px; font-size: 13px;';
		searchEl.value = this.searchQuery;
		searchEl.addEventListener('input', () => {
			this.searchQuery = searchEl.value;
			this.refreshList();
		});

		const allBtn = toolbar.createEl('button');
		allBtn.textContent = 'Select all';
		allBtn.addEventListener('click', () => {
			const visible = this.visibleItems();
			const allOn = visible.every((i) => i.checked);
			for (const item of visible) item.checked = !allOn;
			this.refreshList();
		});

		const noneBtn = toolbar.createEl('button');
		noneBtn.textContent = 'Clear';
		noneBtn.addEventListener('click', () => {
			for (const item of this.visibleItems()) item.checked = false;
			this.refreshList();
		});

		// List
		this.listEl = this.contentEl.createDiv();
		this.listEl.style.cssText =
			'max-height: 380px; overflow-y: auto; margin-bottom: 12px; border: 1px solid var(--background-modifier-border); border-radius: 6px;';

		this.refreshList();

		// Footer
		const footer = new Setting(this.contentEl);
		footer.addButton((btn) =>
			btn.setButtonText('Back').onClick(() => {
				this.state = 'path';
				this.render();
			})
		);
		footer.addButton((btn) => {
			this.importBtn = btn.buttonEl;
			btn
				.setButtonText('')
				.setCta()
				.onClick(() => void this.runImport());
		});

		this.updateImportButtonLabel();
	}

	private visibleItems(): WordItem[] {
		const q = this.searchQuery.trim().toLowerCase();
		if (!q) return this.items;
		return this.items.filter(
			(i) =>
				i.kobo.word.toLowerCase().includes(q) ||
				i.bookName.toLowerCase().includes(q) ||
				(i.kobo.bookTitle ?? '').toLowerCase().includes(q)
		);
	}

	private refreshList() {
		if (!this.listEl) return;
		this.listEl.empty();

		const visible = this.visibleItems();

		if (visible.length === 0) {
			const empty = this.listEl.createDiv();
			empty.style.cssText = 'padding: 24px; text-align: center; color: var(--text-muted); font-size: 13px;';
			empty.textContent = 'No words match.';
			this.updateImportButtonLabel();
			return;
		}

		for (const item of visible) {
			const row = this.listEl.createDiv();
			// CSS grid keeps every column aligned regardless of which rows
			// have the "already saved" tag.
			row.style.cssText =
				'display: grid; grid-template-columns: auto 1fr 220px 110px; align-items: center; gap: 12px; padding: 8px 12px; border-bottom: 1px solid var(--background-modifier-border); cursor: pointer;';
			row.addEventListener('click', (e) => {
				if ((e.target as HTMLElement).tagName === 'INPUT') return;
				item.checked = !item.checked;
				this.refreshList();
			});

			const checkbox = row.createEl('input');
			checkbox.type = 'checkbox';
			checkbox.checked = item.checked;
			checkbox.addEventListener('change', () => {
				item.checked = checkbox.checked;
				this.updateImportButtonLabel();
			});

			const word = row.createDiv();
			word.style.cssText = 'font-size: 14px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
			word.textContent = item.kobo.word;
			if (item.duplicate) {
				word.style.color = 'var(--text-muted)';
				word.style.textDecoration = 'line-through';
			}

			const book = row.createDiv();
			book.style.cssText =
				'color: var(--text-muted); font-size: 12px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
			book.textContent = item.bookName || '(no book)';
			book.title = item.bookName || '(no book)';

			// Always-present tag cell so the column grid stays aligned across rows.
			const tagCell = row.createDiv();
			tagCell.style.cssText = 'text-align: right;';
			if (item.duplicate) {
				const pill = tagCell.createSpan();
				pill.style.cssText =
					'font-size: 11px; padding: 2px 8px; background: var(--background-modifier-border); border-radius: 10px; color: var(--text-muted); white-space: nowrap;';
				pill.textContent = 'already saved';
			}
		}

		this.updateImportButtonLabel();
	}

	private updateImportButtonLabel() {
		if (!this.importBtn) return;
		const selected = this.items.filter((i) => i.checked).length;
		this.importBtn.textContent = selected > 0
			? `Import ${selected} word${selected === 1 ? '' : 's'}`
			: 'Import';
		this.importBtn.disabled = selected === 0;
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
		const queue = this.items.filter((i) => i.checked);
		if (queue.length === 0) return;

		this.state = 'progress';
		this.summary = { imported: 0, skipped: 0, notFound: [], errors: [] };
		this.cancelRequested = false;
		this.render();

		const settings = this.getSettings();
		const existingBooks = new Set<string>();
		// Pre-warm with names already in the books folder so we don't re-create stubs.
		for (const item of queue) {
			if (item.bookName && bookNoteExists(this.app, settings.booksFolder, item.bookName)) {
				existingBooks.add(item.bookName.toLowerCase());
			}
		}

		for (let i = 0; i < queue.length; i++) {
			if (this.cancelRequested) break;
			const item = queue[i];
			const word = item.kobo.word;

			this.updateProgressLine(`Looking up "${word}" (${i + 1} of ${queue.length})…`);

			try {
				const entry = await lookupWord(word);
				const bookName = cleanBookTitle(item.bookName);

				let source: string;
				if (!bookName) {
					source = 'kobo';
				} else if (existingBooks.has(bookName.toLowerCase())) {
					source = `[[${bookName}]]`;
				} else {
					switch (settings.unmatchedBookHandling) {
						case 'create':
							await ensureBookStub(this.app, settings.booksFolder, bookName);
							existingBooks.add(bookName.toLowerCase());
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
					this.summary.notFound.push(word);
				} else {
					this.summary.errors.push({ word, reason: msg });
				}
				console.warn(`[Lexophile] "${word}":`, msg);
			}

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

		const totals = this.contentEl.createEl('p');
		totals.style.cssText = 'font-size: 14px; line-height: 1.6;';
		const totalLines: string[] = [];
		totalLines.push(`✓ Imported ${imported} word${imported === 1 ? '' : 's'}`);
		if (skipped) totalLines.push(`${skipped} already in your lexicon (skipped)`);
		totals.innerHTML = totalLines.map((l) => `• ${l}`).join('<br>');

		if (notFound.length > 0) {
			this.renderWordListSection(
				`${notFound.length} not found in the dictionary`,
				notFound,
				'These weren\'t in api.dictionaryapi.dev. They might be names, slang, or compounds.'
			);
		}

		if (errors.length > 0) {
			const errorList = errors.map((e) => `${e.word} — ${e.reason}`);
			this.renderWordListSection(
				`${errors.length} error${errors.length === 1 ? '' : 's'}`,
				errorList,
				'Likely network issues. Try the import again later.'
			);
		}

		new Setting(this.contentEl).addButton((btn) =>
			btn.setButtonText('Close').setCta().onClick(() => this.close())
		);

		if (imported > 0) {
			new Notice(`Lexophile: imported ${imported} word${imported === 1 ? '' : 's'} from Kobo.`);
		}
	}

	private renderWordListSection(title: string, words: string[], hint: string) {
		const wrap = this.contentEl.createDiv();
		wrap.style.cssText = 'margin-top: 16px;';

		const heading = wrap.createEl('h4', { text: title });
		heading.style.cssText = 'margin: 0 0 4px; font-size: 13px; font-weight: 600;';

		const hintEl = wrap.createEl('p', { text: hint, cls: 'setting-item-description' });
		hintEl.style.cssText = 'margin: 0 0 8px;';

		const list = wrap.createDiv();
		list.style.cssText =
			'max-height: 160px; overflow-y: auto; border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 6px 10px; font-size: 13px; font-family: var(--font-monospace, monospace);';
		for (const word of words) {
			const row = list.createDiv();
			row.style.cssText = 'padding: 2px 0;';
			row.textContent = word;
		}

		const copyBtn = wrap.createEl('button');
		copyBtn.textContent = 'Copy list';
		copyBtn.style.cssText = 'margin-top: 8px;';
		copyBtn.addEventListener('click', async () => {
			try {
				await navigator.clipboard.writeText(words.join('\n'));
				const original = copyBtn.textContent;
				copyBtn.textContent = 'Copied!';
				setTimeout(() => (copyBtn.textContent = original), 1500);
			} catch {
				new Notice('Could not copy to clipboard.');
			}
		});
	}
}
