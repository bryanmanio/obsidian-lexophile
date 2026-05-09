import { AbstractInputSuggest, App, TFolder } from 'obsidian';

export class FolderSuggest extends AbstractInputSuggest<string> {
	private folders: string[];

	constructor(app: App, inputEl: HTMLInputElement, extraDefaults: string[] = []) {
		super(app, inputEl);
		this.folders = this.collectFolders(extraDefaults);
	}

	private collectFolders(extraDefaults: string[]): string[] {
		const set = new Set<string>(extraDefaults);
		const walk = (folder: TFolder) => {
			if (folder.path) set.add(folder.path);
			for (const child of folder.children) {
				if (child instanceof TFolder) walk(child);
			}
		};
		walk(this.app.vault.getRoot());
		return Array.from(set).sort((a, b) => a.localeCompare(b));
	}

	protected getSuggestions(query: string): string[] {
		const q = query.trim().toLowerCase();
		if (!q) return this.folders.slice(0, 12);
		return this.folders.filter((f) => f.toLowerCase().includes(q)).slice(0, 12);
	}

	renderSuggestion(folder: string, el: HTMLElement) {
		el.setText(folder);
	}

	selectSuggestion(folder: string) {
		this.setValue(folder);
		// Trigger input event so any onChange listener picks up the new value
		const inputEl = (this as unknown as { inputEl: HTMLInputElement }).inputEl;
		inputEl.dispatchEvent(new Event('input'));
		this.close();
	}
}
