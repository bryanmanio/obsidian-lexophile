import { App, TFile, TFolder, normalizePath } from 'obsidian';
import { ensureDictionaryBase } from './base';
import { classifyFamiliarity } from './familiarity';
import type { DictionarySettings } from './settings';

export interface WordEntry {
	word: string;
	partOfSpeech?: string;
	definition: string;
	example?: string;
	phonetic?: string;
	source?: string;
}

export interface NoteResult {
	created: boolean;
	path: string;
	action: 'created' | 'skipped' | 'appended' | 'overwritten';
}

// Build a placeholder entry for a word the dictionary API doesn't recognize.
// All fields except `word` and `source` are empty; the template's
// stripEmptyLabelLines pass cleans the body so the note is still tidy.
export function createStubEntry(word: string, source = ''): WordEntry {
	return {
		word: word.trim(),
		partOfSpeech: '',
		definition: '',
		example: '',
		phonetic: '',
		source,
	};
}

// Derives the on-disk path a given word would be written to, given the
// dictionary folder + naming convention. Used by the importer to detect
// duplicates without invoking the full create pipeline.
export function wordNotePath(settings: DictionarySettings, word: string): string {
	let filename = word.trim();
	if (settings.namingConvention === 'lowercase') {
		filename = filename.toLowerCase();
	} else if (settings.namingConvention === 'titlecase') {
		filename = filename.charAt(0).toUpperCase() + filename.slice(1).toLowerCase();
	}
	filename = filename.replace(/[\\/:*?"<>|#^[\]]/g, '');
	const folderPath = normalizePath(settings.folder);
	return normalizePath(`${folderPath}/${filename}.md`);
}

export function wordNoteExists(app: App, settings: DictionarySettings, word: string): boolean {
	return app.vault.getAbstractFileByPath(wordNotePath(settings, word)) instanceof TFile;
}

export async function createWordNote(
	app: App,
	settings: DictionarySettings,
	entry: WordEntry
): Promise<NoteResult> {
	const { vault } = app;

	const filePath = wordNotePath(settings, entry.word);
	const folderPath = normalizePath(settings.folder);

	await ensureFolder(app, folderPath);

	const existing = vault.getAbstractFileByPath(filePath);

	if (existing instanceof TFile) {
		if (settings.duplicateHandling === 'skip') {
			await ensureDictionaryBase(app, settings);
			return { created: false, path: filePath, action: 'skipped' };
		}

		if (settings.duplicateHandling === 'append') {
			const current = await vault.read(existing);
			const addition = '\n\n---\n\n' + renderEntry(entry, settings, false);
			await vault.modify(existing, current + addition);
			await ensureDictionaryBase(app, settings);
			return { created: false, path: filePath, action: 'appended' };
		}

		// Use fileManager.trashFile so it respects the user's deletion preference
		// (system trash, vault trash, or permanent), per Obsidian guidelines.
		await app.fileManager.trashFile(existing);
	}

	await vault.create(filePath, renderEntry(entry, settings, true));
	await ensureDictionaryBase(app, settings);

	const action = existing ? 'overwritten' : 'created';
	return { created: true, path: filePath, action };
}

// Walks the path and creates each missing segment via the vault adapter,
// which works for both regular vault content and config-dir paths.
async function ensureFolder(app: App, folderPath: string): Promise<void> {
	const parts = folderPath.split('/').filter(Boolean);
	let current = '';
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		const existing = app.vault.getAbstractFileByPath(current);
		if (!existing) {
			await app.vault.adapter.mkdir(current);
		} else if (!(existing instanceof TFolder)) {
			throw new Error(`"${current}" exists but is not a folder.`);
		}
	}
}

function renderEntry(
	entry: WordEntry,
	settings: DictionarySettings,
	includeFrontmatter: boolean
): string {
	const today = new Date().toISOString().split('T')[0];
	const values: Record<string, string> = {
		word: entry.word,
		partOfSpeech: entry.partOfSpeech ?? '',
		definition: entry.definition,
		example: entry.example ?? '',
		phonetic: entry.phonetic ?? '',
		date: today,
		source: entry.source ?? '',
		familiarity: classifyFamiliarity(entry.word),
	};

	const template = settings.template;
	const fmMatch = template.match(/^(---\n)([\s\S]*?)(\n---\n?)([\s\S]*)$/);

	let output: string;
	if (fmMatch) {
		const [, fmStart, fmContent, fmEnd, body] = fmMatch;
		const renderedFm = substitute(fmContent, values, escapeYamlDouble);
		const renderedBody = substitute(body, values, (s) => s);
		output = includeFrontmatter ? fmStart + renderedFm + fmEnd + renderedBody : renderedBody;
	} else {
		output = substitute(template, values, (s) => s);
	}

	return stripEmptyLabelLines(output);
}

function substitute(
	text: string,
	values: Record<string, string>,
	transform: (s: string) => string
): string {
	return text.replace(/\{\{(\w+)\}\}/g, (match: string, key: string) => {
		if (Object.prototype.hasOwnProperty.call(values, key)) {
			return transform(values[key]);
		}
		return match;
	});
}

// Escape a value for placement inside a YAML double-quoted scalar.
function escapeYamlDouble(value: string): string {
	return (value ?? '')
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"')
		.replace(/\n/g, '\\n')
		.replace(/\r/g, '\\r')
		.replace(/\t/g, '\\t');
}

// Removes body lines that look like "**Label:** " with no value after substitution.
// Frontmatter (key: value) lines are untouched — they don't match the **bold** pattern.
function stripEmptyLabelLines(content: string): string {
	return content
		.split('\n')
		.filter((line) => !/^\s*\*\*[^*]+:\*\*\s*$/.test(line))
		.join('\n')
		.replace(/\n{3,}/g, '\n\n');
}
