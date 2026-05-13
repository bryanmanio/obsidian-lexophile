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

// Creates a book note from the user-configurable book template. Available
// variables: {{title}}, {{date}}. The template comes from settings, so the
// user can pre-populate Kepano-style frontmatter (author, series, rating,
// etc.) and have every new book stub conform to the same schema.
export async function ensureBookStub(
	app: App,
	folder: string,
	title: string,
	template: string
): Promise<void> {
	const cleaned = cleanBookTitle(title);
	if (!cleaned) return;

	const folderPath = normalizePath(folder);
	const filePath = normalizePath(`${folderPath}/${cleaned}.md`);

	if (app.vault.getAbstractFileByPath(filePath)) return;

	const today = new Date().toISOString().split('T')[0];
	const content = renderTemplate(template, { title: cleaned, date: today });
	await app.vault.create(filePath, content);
}
