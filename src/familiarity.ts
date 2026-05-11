import { COMMON_WORDS, FAMILIAR_WORDS } from './familiarityData';

export type Familiarity = 'common' | 'familiar' | 'obscure';

// Heuristic recognizability score for a word, based on its rank in an English
// unigram frequency corpus. The lookup is case-insensitive and tries the word
// as-is plus a few simple morphological reductions (drop plural -s, drop past
// -ed/-d, drop -ing), so "running" still resolves to "run".
export function classifyFamiliarity(word: string): Familiarity {
	const normalized = word.trim().toLowerCase();
	if (!normalized) return 'obscure';

	for (const candidate of candidateForms(normalized)) {
		if (COMMON_WORDS.has(candidate)) return 'common';
		if (FAMILIAR_WORDS.has(candidate)) return 'familiar';
	}
	return 'obscure';
}

function candidateForms(word: string): string[] {
	const forms = [word];
	if (word.length > 3 && word.endsWith('s')) forms.push(word.slice(0, -1));
	if (word.length > 4 && word.endsWith('es')) forms.push(word.slice(0, -2));
	if (word.length > 4 && word.endsWith('ed')) {
		forms.push(word.slice(0, -1));
		forms.push(word.slice(0, -2));
	}
	if (word.length > 5 && word.endsWith('ing')) {
		forms.push(word.slice(0, -3));
		forms.push(word.slice(0, -3) + 'e');
	}
	if (word.length > 4 && word.endsWith('ly')) forms.push(word.slice(0, -2));
	return forms;
}
