import { requestUrl } from 'obsidian';
import type { WordEntry } from './lexicon';

const API_BASE = 'https://api.dictionaryapi.dev/api/v2/entries/en/';

// Distinguishes "the dictionary API has no entry for this word" from genuine
// errors (network, 5xx, malformed response). Callers can use this to decide
// whether to fall back to a stub note.
export class WordNotFoundError extends Error {
	constructor(public readonly word: string) {
		super(`No definition found for "${word}".`);
		this.name = 'WordNotFoundError';
	}
}

interface ApiPhonetic {
	text?: string;
	audio?: string;
}

interface ApiDefinition {
	definition: string;
	example?: string;
}

interface ApiMeaning {
	partOfSpeech: string;
	definitions: ApiDefinition[];
}

interface ApiEntry {
	word: string;
	phonetic?: string;
	phonetics?: ApiPhonetic[];
	meanings: ApiMeaning[];
}

export async function lookupWord(word: string): Promise<WordEntry> {
	const url = API_BASE + encodeURIComponent(word.trim());
	const res = await requestUrl({ url, method: 'GET', throw: false });

	if (res.status === 404) {
		throw new WordNotFoundError(word);
	}
	if (res.status !== 200) {
		throw new Error(`Dictionary API returned status ${res.status}.`);
	}

	const data = res.json as ApiEntry[];
	if (!Array.isArray(data) || data.length === 0) {
		throw new WordNotFoundError(word);
	}

	const first = data[0];
	const meaning = first.meanings?.[0];
	const definition = meaning?.definitions?.[0];

	if (!meaning || !definition) {
		throw new WordNotFoundError(word);
	}

	const phonetic = first.phonetic ?? first.phonetics?.find((p) => p.text)?.text ?? '';

	return {
		word: first.word,
		partOfSpeech: meaning.partOfSpeech,
		definition: definition.definition,
		example: definition.example ?? '',
		phonetic,
		source: '',
	};
}
