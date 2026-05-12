import { App, Modal, Notice, Setting } from 'obsidian';
import { lookupWord, WordNotFoundError } from './dictionary';
import { type DictionaryStore } from './dictionaryStore';
import { createStubEntry, createWordNote, wordNoteExists, type WordEntry } from './lexicon';
import type { DictionarySettings } from './settings';

// Spacing between consecutive lookups. The free Dictionary API rate-limits
// faster than ~3 req/s, but local SQLite lookups are sub-millisecond — pick
// per-import based on the user's chosen source.
const API_DELAY_MS = 350;
const LOCAL_YIELD_MS = 0;

type State = 'input' | 'wordlist' | 'progress' | 'done';

interface WordItem {
	word: string;
	checked: boolean;
	duplicate: boolean;
}

interface ImportSummary {
	imported: number;
	skipped: number;
	stubbed: number;
	notFound: string[];
	errors: { word: string; reason: string }[];
}

// Accepts a free-form blob and pulls out plausible word tokens. Splits on
// commas, semicolons, and any whitespace (newlines, tabs, spaces), then strips
// surrounding punctuation and dedupes case-insensitively while preserving the
// first-seen casing.
export function parseWordList(raw: string): string[] {
	const tokens = raw.split(/[\s,;]+/).map((t) => t.replace(/^[^\p{L}'-]+|[^\p{L}'-]+$/gu, ''));
	const seen = new Set<string>();
	const out: string[] = [];
	for (const t of tokens) {
		if (!t) continue;
		const key = t.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(t);
	}
	return out;
}

export class MassImportModal extends Modal {
	private getSettings: () => DictionarySettings;
	private state: State = 'input';

	// Input state
	private rawInput = '';
	private stubUnfound = false;
	private inputError = '';

	// Word list state
	private items: WordItem[] = [];
	private searchQuery = '';
	private listEl: HTMLElement | null = null;
	private importBtn: HTMLButtonElement | null = null;

	// Progress state
	private progressLine = '';
	private progressEl: HTMLElement | null = null;
	private summary: ImportSummary = { imported: 0, skipped: 0, stubbed: 0, notFound: [], errors: [] };
	private cancelRequested = false;

	private store: DictionaryStore;

	constructor(app: App, getSettings: () => DictionarySettings, store: DictionaryStore) {
		super(app);
		this.getSettings = getSettings;
		this.store = store;
	}

	onOpen() {
		this.modalEl.addClass('lex-modal-wide');
		this.stubUnfound = this.getSettings().stubUnfoundWords;
		this.render();
	}

	onClose() {
		this.cancelRequested = true;
		this.contentEl.empty();
	}

	private render() {
		this.contentEl.empty();
		if (this.state === 'input') return this.renderInputState();
		if (this.state === 'wordlist') return this.renderWordListState();
		if (this.state === 'progress') return this.renderProgressState();
		this.renderDoneState();
	}

	// ── State 1: paste a list ──────────────────────────────────────

	private renderInputState() {
		this.contentEl.createEl('h3', { text: 'Mass-import words' });
		this.contentEl.createEl('p', {
			text: 'Paste a list of words below. Separate them with commas, spaces, or new lines — Lexophile will figure it out.',
			cls: 'setting-item-description',
		});

		const textarea = this.contentEl.createEl('textarea', { cls: 'lex-mass-input' });
		textarea.rows = 10;
		textarea.placeholder = 'serendipity, ephemeral, perspicacious\ngossamer\nalacrity';
		textarea.value = this.rawInput;
		textarea.addEventListener('input', () => (this.rawInput = textarea.value));

		if (this.inputError) {
			this.contentEl.createEl('p', { text: this.inputError, cls: 'lex-error-line' });
		}

		const stubOpt = this.contentEl.createDiv({ cls: 'lex-stub-option' });
		const cb = stubOpt.createEl('input');
		cb.type = 'checkbox';
		cb.id = 'lex-mass-stub';
		cb.checked = this.stubUnfound;
		cb.addEventListener('change', () => (this.stubUnfound = cb.checked));
		const label = stubOpt.createEl('label', { cls: 'lex-stub-option-label' });
		label.htmlFor = 'lex-mass-stub';
		label.appendText('Create stub notes for words not found in the dictionary');

		new Setting(this.contentEl)
			.addButton((btn) => btn.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((btn) =>
				btn
					.setButtonText('Parse list')
					.setCta()
					.onClick(() => this.parseInput())
			);

		window.setTimeout(() => textarea.focus(), 0);
	}

	private parseInput() {
		this.inputError = '';
		const settings = this.getSettings();
		if (settings.dictionarySource === 'local' && !this.store.isReady()) {
			this.inputError = 'Local dictionary not loaded. Download it from Settings → Lexophile first.';
			this.render();
			return;
		}
		const words = parseWordList(this.rawInput);
		if (words.length === 0) {
			this.inputError = 'No words detected. Paste a comma- or newline-separated list above.';
			this.render();
			return;
		}

		this.items = words.map((word) => {
			const dup = wordNoteExists(this.app, settings, word);
			return { word, checked: !dup, duplicate: dup };
		});
		this.searchQuery = '';
		this.state = 'wordlist';
		this.render();
	}

	// ── State 2: review parsed words ──────────────────────────────

	private renderWordListState() {
		const total = this.items.length;
		const dupCount = this.items.filter((i) => i.duplicate).length;

		this.contentEl.createEl('h3', {
			text: `${total} word${total === 1 ? '' : 's'} ready to import`,
		});

		const desc = this.contentEl.createEl('p', { cls: 'setting-item-description' });
		desc.appendText('Review the parsed list. ');
		if (dupCount > 0) {
			desc.appendText(`${dupCount} ${dupCount === 1 ? 'is' : 'are'} already in your lexicon and pre-unchecked.`);
		}

		const stubOpt = this.contentEl.createDiv({ cls: 'lex-stub-option lex-stub-option--inline' });
		const cb = stubOpt.createEl('input');
		cb.type = 'checkbox';
		cb.id = 'lex-mass-stub-2';
		cb.checked = this.stubUnfound;
		cb.addEventListener('change', () => (this.stubUnfound = cb.checked));
		const label = stubOpt.createEl('label', { cls: 'lex-stub-option-label' });
		label.htmlFor = 'lex-mass-stub-2';
		label.appendText('Create stub notes for words not found in the dictionary');

		const toolbar = this.contentEl.createDiv({ cls: 'lex-toolbar' });

		const searchEl = toolbar.createEl('input', { cls: 'lex-toolbar-search' });
		searchEl.type = 'text';
		searchEl.placeholder = 'Search words…';
		searchEl.value = this.searchQuery;
		searchEl.addEventListener('input', () => {
			this.searchQuery = searchEl.value;
			this.refreshList();
		});

		const allBtn = toolbar.createEl('button', { text: 'Select all' });
		allBtn.addEventListener('click', () => {
			const visible = this.visibleItems();
			const allOn = visible.every((i) => i.checked);
			for (const item of visible) item.checked = !allOn;
			this.refreshList();
		});

		const noneBtn = toolbar.createEl('button', { text: 'Clear' });
		noneBtn.addEventListener('click', () => {
			for (const item of this.visibleItems()) item.checked = false;
			this.refreshList();
		});

		this.listEl = this.contentEl.createDiv({ cls: 'lex-wordlist lex-wordlist--narrow' });
		this.refreshList();

		const footer = new Setting(this.contentEl);
		footer.addButton((btn) =>
			btn.setButtonText('Back').onClick(() => {
				this.state = 'input';
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
		return this.items.filter((i) => i.word.toLowerCase().includes(q));
	}

	private refreshList() {
		if (!this.listEl) return;
		this.listEl.empty();

		const visible = this.visibleItems();
		if (visible.length === 0) {
			this.listEl.createDiv({ cls: 'lex-wordlist-empty', text: 'No words match.' });
			this.updateImportButtonLabel();
			return;
		}

		for (const item of visible) {
			const row = this.listEl.createDiv({ cls: 'lex-row lex-row--mass' });
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

			const wordCls = item.duplicate ? 'lex-row-word lex-row-word--duplicate' : 'lex-row-word';
			row.createDiv({ cls: wordCls, text: item.word });

			const tagCell = row.createDiv({ cls: 'lex-row-tag-cell' });
			if (item.duplicate) {
				tagCell.createSpan({ cls: 'lex-row-tag-pill', text: 'already saved' });
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

	// ── State 3: progress ─────────────────────────────────────────

	private renderProgressState() {
		this.contentEl.createEl('h3', { text: 'Importing…' });
		this.progressEl = this.contentEl.createEl('p', {
			cls: 'lex-progress',
			text: this.progressLine || 'Starting…',
		});
	}

	private updateProgressLine(line: string) {
		this.progressLine = line;
		if (this.progressEl) this.progressEl.textContent = line;
	}

	private async runImport() {
		const queue = this.items.filter((i) => i.checked);
		if (queue.length === 0) return;

		this.state = 'progress';
		this.summary = { imported: 0, skipped: 0, stubbed: 0, notFound: [], errors: [] };
		this.cancelRequested = false;
		this.render();

		const settings = this.getSettings();
		const delayMs = settings.dictionarySource === 'api' ? API_DELAY_MS : LOCAL_YIELD_MS;

		for (let i = 0; i < queue.length; i++) {
			if (this.cancelRequested) break;
			const { word } = queue[i];

			this.updateProgressLine(`Looking up "${word}" (${i + 1} of ${queue.length})…`);

			let entry: WordEntry;
			let stubbed = false;
			try {
				entry = await lookupWord(this.store, word, settings.dictionarySource);
			} catch (err) {
				if (err instanceof WordNotFoundError) {
					if (this.stubUnfound) {
						entry = createStubEntry(word);
						stubbed = true;
					} else {
						this.summary.notFound.push(word);
						if (i < queue.length - 1) await new Promise((r) => window.setTimeout(r, delayMs));
						continue;
					}
				} else {
					this.summary.errors.push({ word, reason: (err as Error).message });
					if (i < queue.length - 1) await new Promise((r) => window.setTimeout(r, delayMs));
					continue;
				}
			}

			entry.source = 'manual';
			try {
				const result = await createWordNote(this.app, settings, entry);
				if (result.action === 'skipped') this.summary.skipped++;
				else if (stubbed) this.summary.stubbed++;
				else this.summary.imported++;
			} catch (err) {
				this.summary.errors.push({ word, reason: (err as Error).message });
			}

			if (i < queue.length - 1) await new Promise((r) => window.setTimeout(r, delayMs));
		}

		this.state = 'done';
		this.render();
	}

	// ── State 4: done ─────────────────────────────────────────────

	private renderDoneState() {
		this.contentEl.createEl('h3', { text: this.cancelRequested ? 'Import cancelled' : 'Done' });

		const { imported, skipped, stubbed, notFound, errors } = this.summary;

		const totals = this.contentEl.createEl('ul', { cls: 'lex-totals' });
		totals.createEl('li', { text: `✓ Imported ${imported} word${imported === 1 ? '' : 's'}` });
		if (stubbed) {
			totals.createEl('li', {
				text: `✎ Created ${stubbed} stub${stubbed === 1 ? '' : 's'} for unknown words`,
			});
		}
		if (skipped) {
			totals.createEl('li', { text: `${skipped} already in your lexicon (skipped)` });
		}

		if (notFound.length > 0) {
			this.renderWordListSection(
				`${notFound.length} not found in the dictionary`,
				notFound,
				"These words weren't found in the dictionary. They might be names, slang, compounds, or don't exist in the online dictionary we pull from."
			);

			const stubBtnWrap = this.contentEl.createDiv({ cls: 'lex-done-stub-btn-wrap' });
			const stubBtn = stubBtnWrap.createEl('button', {
				text: `Create stub notes for these ${notFound.length} word${notFound.length === 1 ? '' : 's'}`,
			});
			stubBtn.addEventListener('click', () => {
				void this.stubNotFound(stubBtn);
			});
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

		if (imported > 0 || stubbed > 0) {
			const parts: string[] = [];
			if (imported > 0) parts.push(`imported ${imported}`);
			if (stubbed > 0) parts.push(`stubbed ${stubbed}`);
			new Notice(`Lexophile: ${parts.join(', ')} word${imported + stubbed === 1 ? '' : 's'}.`);
		}
	}

	private async stubNotFound(triggerBtn: HTMLButtonElement) {
		const pending = this.summary.notFound.slice();
		if (pending.length === 0) return;

		triggerBtn.disabled = true;
		triggerBtn.textContent = 'Creating stubs…';

		const settings = this.getSettings();
		let created = 0;
		const stillFailed: string[] = [];

		for (const word of pending) {
			try {
				const entry = createStubEntry(word, 'manual');
				const result = await createWordNote(this.app, settings, entry);
				if (result.action !== 'skipped') created++;
			} catch (err) {
				stillFailed.push(word);
				console.warn(`[Lexophile] stub "${word}":`, (err as Error).message);
			}
		}

		this.summary.stubbed += created;
		this.summary.notFound = stillFailed;
		new Notice(`Lexophile: created ${created} stub${created === 1 ? '' : 's'}.`);
		this.render();
	}

	private renderWordListSection(title: string, words: string[], hint: string) {
		const wrap = this.contentEl.createDiv({ cls: 'lex-done-section' });
		wrap.createEl('h4', { cls: 'lex-done-heading', text: title });
		wrap.createEl('p', { cls: 'setting-item-description lex-done-hint', text: hint });

		const list = wrap.createDiv({ cls: 'lex-done-list' });
		for (const word of words) {
			list.createDiv({ cls: 'lex-done-list-row', text: word });
		}

		const copyBtn = wrap.createEl('button', { cls: 'lex-done-copy-btn', text: 'Copy list' });
		copyBtn.addEventListener('click', () => {
			void (async () => {
				try {
					await navigator.clipboard.writeText(words.join('\n'));
					const original = copyBtn.textContent;
					copyBtn.textContent = 'Copied!';
					window.setTimeout(() => (copyBtn.textContent = original), 1500);
				} catch {
					new Notice('Could not copy to clipboard.');
				}
			})();
		});
	}
}
