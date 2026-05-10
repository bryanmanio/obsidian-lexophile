import { App, Modal, Notice, Setting } from 'obsidian';
import { lookupWord } from './dictionary';
import { createWordNote } from './lexicon';
import type { DictionarySettings } from './settings';

export class AddWordModal extends Modal {
	private word = '';
	private submitting = false;
	private inputEl: HTMLInputElement | null = null;
	private submitBtn: HTMLButtonElement | null = null;
	private getSettings: () => DictionarySettings;

	constructor(app: App, getSettings: () => DictionarySettings) {
		super(app);
		this.getSettings = getSettings;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h3', { text: 'Add word to lexicon' });

		new Setting(contentEl)
			.setName('Word')
			.setDesc('Enter or paste a word to look up in the dictionary.')
			.addText((text) => {
				this.inputEl = text.inputEl;
				text.setPlaceholder('serendipity');
				text.onChange((v) => (this.word = v));
				text.inputEl.addEventListener('keydown', (e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						void this.submit();
					}
				});
			});

		new Setting(contentEl).addButton((btn) => {
			this.submitBtn = btn.buttonEl;
			btn
				.setButtonText('Look up & save')
				.setCta()
				.onClick(() => void this.submit());
		});

		// Focus the input after the modal renders
		window.setTimeout(() => this.inputEl?.focus(), 0);
	}

	private async submit() {
		if (this.submitting) return;

		const word = this.word.trim();
		if (!word) {
			new Notice('Lexophile: please enter a word.');
			return;
		}

		this.submitting = true;
		if (this.submitBtn) {
			this.submitBtn.disabled = true;
			this.submitBtn.textContent = 'Looking up…';
		}

		try {
			const entry = await lookupWord(word);
			entry.source = 'manual';
			const result = await createWordNote(this.app, this.getSettings(), entry);
			new Notice(`Lexophile: ${result.action} "${entry.word}"`);
			this.close();
		} catch (err) {
			new Notice(`Lexophile: ${(err as Error).message}`);
			this.submitting = false;
			if (this.submitBtn) {
				this.submitBtn.disabled = false;
				this.submitBtn.textContent = 'Look up & save';
			}
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}
