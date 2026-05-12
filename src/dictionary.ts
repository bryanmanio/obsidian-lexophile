import { requestUrl } from 'obsidian';
import { DictionaryNotReadyError, DictionaryStore } from './dictionaryStore';
import type { WordEntry } from './lexicon';
import type { DictionarySource } from './settings';

// Distinguishes "the dictionary has no entry for this word" from genuine
// errors (not-ready store, network, 5xx, malformed response). Callers can
// use this to decide whether to fall back to a stub note.
export class WordNotFoundError extends Error {
	constructor(public readonly word: string) {
		super(`No definition found for "${word}".`);
		this.name = 'WordNotFoundError';
	}
}

export { DictionaryNotReadyError };

// Dispatch to either the remote Free Dictionary API or the local SQLite,
// based on the user's chosen source. Modal callers pass settings.dictionarySource.
export async function lookupWord(
	store: DictionaryStore,
	word: string,
	source: DictionarySource
): Promise<WordEntry> {
	if (source === 'api') return lookupWordViaApi(word);
	return lookupWordViaLocal(store, word);
}

// ── Local SQLite path ───────────────────────────────────────────────

function lookupWordViaLocal(store: DictionaryStore, word: string): WordEntry {
	const result = store.lookup(word);
	if (!result) throw new WordNotFoundError(word);
	return result;
}

// ── Free Dictionary API path ────────────────────────────────────────

const API_BASE = 'https://api.dictionaryapi.dev/api/v2/entries/en/';

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

// dictionaryapi.dev returns 429 (Too Many Requests) and occasionally 503 under
// load. Both are transient — back off and retry. Other non-200 statuses
// (besides 404, which is handled separately as "word not found") are surfaced
// to the caller.
const MAX_RETRIES = 4;
const BASE_BACKOFF_MS = 1500;

async function lookupWordViaApi(word: string): Promise<WordEntry> {
	const url = API_BASE + encodeURIComponent(word.trim());

	let res = await requestUrl({ url, method: 'GET', throw: false });
	let attempt = 0;
	while ((res.status === 429 || res.status === 503) && attempt < MAX_RETRIES) {
		const delay = BASE_BACKOFF_MS * Math.pow(2, attempt);
		await new Promise((r) => setTimeout(r, delay));
		attempt++;
		res = await requestUrl({ url, method: 'GET', throw: false });
	}

	if (res.status === 404) {
		throw new WordNotFoundError(word);
	}
	if (res.status === 429) {
		throw new Error(`Rate-limited by Dictionary API after ${attempt} retries. Try a smaller batch or wait a minute.`);
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
