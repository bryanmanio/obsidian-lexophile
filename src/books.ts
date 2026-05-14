import { App, TFile, TFolder, normalizePath } from 'obsidian';
import { renderTemplate } from './template';

const LOWERCASE_WORDS = new Set([
	'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in',
	'into', 'nor', 'of', 'on', 'onto', 'or', 'over', 'so', 'the',
	'to', 'up', 'with', 'yet',
]);

export function titleCase(input: string): string {
	const trimmed = (input || '').trim();
	if (!trimmed) return '';

	const words = trimmed.split(/\s+/);
	return words
		.map((word, i) => {
			const lower = word.toLowerCase();
			const isFirst = i === 0;
			const isLast = i === words.length - 1;
			if (!isFirst && !isLast && LOWERCASE_WORDS.has(lower)) return lower;
			return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
		})
		.join(' ');
}

// Strip characters Obsidian can't use in filenames or wikilinks.
export function cleanBookTitle(title: string): string {
	return (title || '').replace(/[\\/:*?"<>|#^[\]]/g, '').trim();
}

export function listBookNotes(app: App, folder: string): string[] {
	const folderPath = normalizePath(folder);
	const f = app.vault.getAbstractFileByPath(folderPath);
	if (!(f instanceof TFolder)) return [];

	return f.children
		.filter((child): child is TFile => child instanceof TFile && child.extension === 'md')
		.map((file) => file.basename)
		.sort((a, b) => a.localeCompare(b));
}

export function bookNoteExists(app: App, folder: string, title: string): boolean {
	const cleaned = cleanBookTitle(title);
	if (!cleaned) return false;
	const filePath = normalizePath(`${normalizePath(folder)}/${cleaned}.md`);
	return app.vault.getAbstractFileByPath(filePath) instanceof TFile;
}

// Returns the basename of any note in the vault that matches the given name
// case-insensitively, or null if none exists. Lets the mass-import flow link
// to an existing source by typed name regardless of which folder it lives in.
export function findNoteByName(app: App, name: string): string | null {
	const cleaned = cleanBookTitle(name);
	if (!cleaned) return null;
	const target = cleaned.toLowerCase();
	for (const file of app.vault.getMarkdownFiles()) {
		if (file.basename.toLowerCase() === target) return file.basename;
	}
	return null;
}

// Creates an entity note (book, source, etc.) from a user-configurable
// template. Available variables: {{title}}, {{date}}. Returns the cleaned
// title used in the filename, or null if nothing was created (empty title,
// or a file already exists at the resolved path).
export async function ensureEntityStub(
	app: App,
	folder: string,
	title: string,
	template: string
): Promise<string | null> {
	const cleaned = cleanBookTitle(title);
	if (!cleaned) return null;

	const folderPath = folder ? normalizePath(folder) : '';
	const filePath = folderPath
		? normalizePath(`${folderPath}/${cleaned}.md`)
		: normalizePath(`${cleaned}.md`);

	if (app.vault.getAbstractFileByPath(filePath)) return cleaned;

	if (folderPath && !app.vault.getAbstractFileByPath(folderPath)) {
		await app.vault.adapter.mkdir(folderPath);
	}

	const today = new Date().toISOString().split('T')[0];
	const content = renderTemplate(template, { title: cleaned, date: today });
	await app.vault.create(filePath, content);
	return cleaned;
}

// Back-compat alias for the Kobo import call site (which only cares about
// fire-and-forget book stub creation, not the resolved title).
export async function ensureBookStub(
	app: App,
	folder: string,
	title: string,
	template: string
): Promise<void> {
	await ensureEntityStub(app, folder, title, template);
}
