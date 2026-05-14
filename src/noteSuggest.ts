import { AbstractInputSuggest, App, TFile } from 'obsidian';

// Autocomplete against every Markdown note in the vault. Matches by basename
// substring (case-insensitive) so the user can type "atom" and find
// "Atomic Habits". The selected value is the basename — wikilinks use just
// the basename and Obsidian resolves the path automatically.
export class NoteSuggest extends AbstractInputSuggest<string> {
	private notes: string[];

	constructor(app: App, inputEl: HTMLInputElement) {
		super(app, inputEl);
		this.notes = this.collectNotes();
	}

	private collectNotes(): string[] {
		const names = new Set<string>();
		for (const file of this.app.vault.getMarkdownFiles()) {
			names.add(file.basename);
		}
		return Array.from(names).sort((a, b) => a.localeCompare(b));
	}

	protected getSuggestions(query: string): string[] {
		const q = query.trim().toLowerCase();
		if (!q) return this.notes.slice(0, 12);
		return this.notes.filter((n) => n.toLowerCase().includes(q)).slice(0, 12);
	}

	renderSuggestion(note: string, el: HTMLElement) {
		el.setText(note);
	}

	selectSuggestion(note: string) {
		this.setValue(note);
		const inputEl = (this as unknown as { inputEl: HTMLInputElement }).inputEl;
		inputEl.dispatchEvent(new Event('input'));
		this.close();
	}
}
