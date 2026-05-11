import { App, Modal, Notice, Setting } from 'obsidian';
import { lookupWord, WordNotFoundError } from './dictionary';
import { DictionaryNotReadyError, type DictionaryStore } from './dictionaryStore';
import { createStubEntry, createWordNote, wordNoteExists, type WordEntry } from './lexicon';
import type { DictionarySettings } from './settings';

// Local SQLite lookups are sub-millisecond, but we still yield to the event
// loop between iterations so the progress line can repaint.
const YIELD_MS = 0;

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
		this.modalEl.style.maxWidth = '720px';
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

		const textarea = this.contentEl.createEl('textarea');
		textarea.rows = 10;
		textarea.placeholder = 'serendipity, ephemeral, perspicacious\ngossamer\nalacrity';
		textarea.style.cssText =
			'width: 100%; font-family: var(--font-monospace, monospace); font-size: 13px; padding: 10px; margin-bottom: 8px; resize: vertical;';
		textarea.value = this.rawInput;
		textarea.addEventListener('input', () => (this.rawInput = textarea.value));

		if (this.inputError) {
			const err = this.contentEl.createEl('p');
			err.style.cssText = 'color: var(--text-error); font-size: 13px; margin-top: 4px;';
			err.textContent = this.inputError;
		}

		const stubOpt = this.contentEl.createDiv();
		stubOpt.style.cssText =
			'display: flex; align-items: center; gap: 8px; margin: 10px 0; padding: 8px 12px; background: var(--background-secondary); border-radius: 6px; font-size: 13px;';
		const cb = stubOpt.createEl('input');
		cb.type = 'checkbox';
		cb.id = 'lex-mass-stub';
		cb.checked = this.stubUnfound;
		cb.addEventListener('change', () => (this.stubUnfound = cb.checked));
		const label = stubOpt.createEl('label');
		label.htmlFor = 'lex-mass-stub';
		label.style.cssText = 'cursor: pointer; flex: 1;';
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
		if (!this.store.isReady()) {
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

		const settings = this.getSettings();
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

		const stubOpt = this.contentEl.createDiv();
		stubOpt.style.cssText =
			'display: flex; align-items: center; gap: 8px; margin: 10px 0 0; padding: 8px 12px; background: var(--background-secondary); border-radius: 6px; font-size: 13px;';
		const cb = stubOpt.createEl('input');
		cb.type = 'checkbox';
		cb.id = 'lex-mass-stub-2';
		cb.checked = this.stubUnfound;
		cb.addEventListener('change', () => (this.stubUnfound = cb.checked));
		const label = stubOpt.createEl('label');
		label.htmlFor = 'lex-mass-stub-2';
		label.style.cssText = 'cursor: pointer; flex: 1;';
		label.appendText('Create stub notes for words not found in the dictionary');

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

		this.listEl = this.contentEl.createDiv();
		this.listEl.style.cssText =
			'max-height: 360px; overflow-y: auto; margin-bottom: 12px; border: 1px solid var(--background-modifier-border); border-radius: 6px;';
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
			const empty = this.listEl.createDiv();
			empty.style.cssText = 'padding: 24px; text-align: center; color: var(--text-muted); font-size: 13px;';
			empty.textContent = 'No words match.';
			this.updateImportButtonLabel();
			return;
		}

		for (const item of visible) {
			const row = this.listEl.createDiv();
			row.style.cssText =
				'display: grid; grid-template-columns: auto 1fr 110px; align-items: center; gap: 12px; padding: 8px 12px; border-bottom: 1px solid var(--background-modifier-border); cursor: pointer;';
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
			word.textContent = item.word;
			if (item.duplicate) {
				word.style.color = 'var(--text-muted)';
				word.style.textDecoration = 'line-through';
			}

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

	// ── State 3: progress ─────────────────────────────────────────

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
		this.summary = { imported: 0, skipped: 0, stubbed: 0, notFound: [], errors: [] };
		this.cancelRequested = false;
		this.render();

		const settings = this.getSettings();

		for (let i = 0; i < queue.length; i++) {
			if (this.cancelRequested) break;
			const { word } = queue[i];

			this.updateProgressLine(`Looking up "${word}" (${i + 1} of ${queue.length})…`);

			let entry: WordEntry;
			let stubbed = false;
			try {
				entry = await lookupWord(this.store, word);
			} catch (err) {
				if (err instanceof WordNotFoundError) {
					if (this.stubUnfound) {
						entry = createStubEntry(word);
						stubbed = true;
					} else {
						this.summary.notFound.push(word);
						if (i < queue.length - 1) await new Promise((r) => setTimeout(r, YIELD_MS));
						continue;
					}
				} else {
					this.summary.errors.push({ word, reason: (err as Error).message });
					if (i < queue.length - 1) await new Promise((r) => setTimeout(r, YIELD_MS));
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

			if (i < queue.length - 1) await new Promise((r) => setTimeout(r, YIELD_MS));
		}

		this.state = 'done';
		this.render();
	}

	// ── State 4: done ─────────────────────────────────────────────

	private renderDoneState() {
		this.contentEl.createEl('h3', { text: this.cancelRequested ? 'Import cancelled' : 'Done' });

		const { imported, skipped, stubbed, notFound, errors } = this.summary;

		const totals = this.contentEl.createEl('p');
		totals.style.cssText = 'font-size: 14px; line-height: 1.6;';
		const totalLines: string[] = [];
		totalLines.push(`✓ Imported ${imported} word${imported === 1 ? '' : 's'}`);
		if (stubbed) totalLines.push(`✎ Created ${stubbed} stub${stubbed === 1 ? '' : 's'} for unknown words`);
		if (skipped) totalLines.push(`${skipped} already in your lexicon (skipped)`);
		totals.innerHTML = totalLines.map((l) => `• ${l}`).join('<br>');

		if (notFound.length > 0) {
			this.renderWordListSection(
				`${notFound.length} not found in the dictionary`,
				notFound,
				"These weren't in api.dictionaryapi.dev. They might be names, slang, or compounds."
			);

			const stubBtnWrap = this.contentEl.createDiv();
			stubBtnWrap.style.cssText = 'margin-top: 8px;';
			const stubBtn = stubBtnWrap.createEl('button');
			stubBtn.textContent = `Create stub notes for these ${notFound.length} word${notFound.length === 1 ? '' : 's'}`;
			stubBtn.addEventListener('click', () => void this.stubNotFound(stubBtn));
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
