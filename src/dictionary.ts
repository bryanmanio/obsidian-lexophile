import { DictionaryNotReadyError, DictionaryStore } from './dictionaryStore';
import type { WordEntry } from './lexicon';

// Distinguishes "the dictionary has no entry for this word" from genuine
// errors (not-ready store, IO failure). Callers can use this to decide
// whether to fall back to a stub note.
export class WordNotFoundError extends Error {
	constructor(public readonly word: string) {
		super(`No definition found for "${word}".`);
		this.name = 'WordNotFoundError';
	}
}

export { DictionaryNotReadyError };

// Looks up a single word against the local SQLite dictionary. The store is
// passed in (rather than being a module global) so tests and modal callers
// can use the same singleton the plugin instantiated.
export async function lookupWord(store: DictionaryStore, word: string): Promise<WordEntry> {
	const result = store.lookup(word);
	if (!result) throw new WordNotFoundError(word);
	return result;
}
