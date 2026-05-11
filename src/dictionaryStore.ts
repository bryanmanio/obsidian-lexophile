import { App, Plugin, requestUrl } from 'obsidian';
import type { Database } from 'sql.js';
import { getSqlJs } from './sqlite';
import type { WordEntry } from './lexicon';

// The local SQLite shipped via release asset has roughly this shape:
//   CREATE TABLE entries (
//     word TEXT PRIMARY KEY,
//     part_of_speech TEXT,
//     definition TEXT NOT NULL,
//     example TEXT,
//     phonetic TEXT
//   );
//   CREATE INDEX idx_word_lower ON entries(LOWER(word));
const DB_FILENAME = 'dictionary.sqlite';

// Default download URL — a release asset on the plugin repo. Users can
// override this in settings if they prefer to host their own mirror.
export const DEFAULT_DICTIONARY_URL =
	'https://github.com/bryanmanio/obsidian-lexophile/releases/download/dictionary-v1/dictionary.sqlite';

export class DictionaryNotReadyError extends Error {
	constructor() {
		super('Local dictionary not loaded. Download it from Settings → Lexophile.');
		this.name = 'DictionaryNotReadyError';
	}
}

export interface DictionaryStatus {
	ready: boolean;
	sizeBytes: number | null; // bytes on disk, or null if missing
	entryCount: number | null; // null if not loaded
}

// Loads and queries the bundled dictionary SQLite. Lazy: nothing happens
// until init() succeeds, and a missing file leaves the store in "not ready"
// mode rather than throwing. Callers detect not-ready via isReady() and
// surface a download prompt.
export class DictionaryStore {
	private db: Database | null = null;
	private entryCount: number | null = null;

	constructor(private app: App, private plugin: Plugin) {}

	// Resolves vault-relative path to the SQLite, e.g.
	// ".obsidian/plugins/lexophile/dictionary.sqlite".
	private dbPath(): string {
		// configDir is "<vault>/.obsidian" (or user-renamed) — normalize the
		// path manually so we don't need the obsidian normalizePath helper here.
		const configDir = this.app.vault.configDir;
		const id = this.plugin.manifest.id;
		return `${configDir}/plugins/${id}/${DB_FILENAME}`;
	}

	// Attempts to load the file from disk. Safe to call repeatedly; subsequent
	// calls are no-ops once loaded. Returns true if the dictionary is ready.
	async init(): Promise<boolean> {
		if (this.db) return true;

		const path = this.dbPath();
		const exists = await this.app.vault.adapter.exists(path);
		if (!exists) return false;

		const buf = await this.app.vault.adapter.readBinary(path);
		const SQL = await getSqlJs();
		this.db = new SQL.Database(new Uint8Array(buf));
		this.entryCount = this.countEntries();
		return true;
	}

	isReady(): boolean {
		return this.db !== null;
	}

	async status(): Promise<DictionaryStatus> {
		const path = this.dbPath();
		const exists = await this.app.vault.adapter.exists(path);
		let sizeBytes: number | null = null;
		if (exists) {
			const stat = await this.app.vault.adapter.stat(path);
			sizeBytes = stat?.size ?? null;
		}
		return { ready: this.isReady(), sizeBytes, entryCount: this.entryCount };
	}

	// Downloads the dictionary SQLite from the given URL into the plugin
	// folder, then loads it. Caller is responsible for surfacing progress —
	// requestUrl doesn't expose chunk events, so we report start and end only.
	async download(url: string): Promise<void> {
		const res = await requestUrl({ url, method: 'GET', throw: false });
		if (res.status !== 200) {
			throw new Error(`Download failed: HTTP ${res.status}`);
		}

		// requestUrl returns arrayBuffer for binary content.
		const buf: ArrayBuffer = res.arrayBuffer;
		if (buf.byteLength < 16 || !this.looksLikeSqlite(new Uint8Array(buf))) {
			throw new Error('Downloaded file does not look like a SQLite database.');
		}

		// adapter.writeBinary doesn't create parent directories — confirmed in
		// obsidian.d.ts. The plugin folder is usually present (we run from it)
		// but isn't guaranteed in cloud-synced vaults at the moment of write.
		// adapter.mkdir is idempotent on Obsidian's adapter; it's safe to call
		// repeatedly and creates intermediate segments.
		const path = this.dbPath();
		const parent = path.substring(0, path.lastIndexOf('/'));
		if (parent && !(await this.app.vault.adapter.exists(parent))) {
			await this.app.vault.adapter.mkdir(parent);
		}

		await this.app.vault.adapter.writeBinary(path, buf);

		// Close any previously-loaded DB so init() picks up the new file.
		this.close();
		await this.init();
	}

	// Looks up a word case-insensitively. Returns null if not found. The
	// caller (lookupWord in dictionary.ts) translates null into
	// WordNotFoundError so existing call sites keep working.
	lookup(word: string): WordEntry | null {
		if (!this.db) throw new DictionaryNotReadyError();
		const stmt = this.db.prepare(
			'SELECT word, part_of_speech, definition, example, phonetic ' +
				'FROM entries WHERE LOWER(word) = LOWER(?) LIMIT 1'
		);
		try {
			stmt.bind([word.trim()]);
			if (!stmt.step()) return null;
			const row = stmt.getAsObject() as {
				word?: string;
				part_of_speech?: string;
				definition?: string;
				example?: string;
				phonetic?: string;
			};
			return {
				word: String(row.word ?? word),
				partOfSpeech: row.part_of_speech ?? '',
				definition: String(row.definition ?? ''),
				example: row.example ?? '',
				phonetic: row.phonetic ?? '',
				source: '',
			};
		} finally {
			stmt.free();
		}
	}

	close(): void {
		if (this.db) {
			this.db.close();
			this.db = null;
			this.entryCount = null;
		}
	}

	private countEntries(): number | null {
		if (!this.db) return null;
		const res = this.db.exec('SELECT COUNT(*) FROM entries');
		return Number(res?.[0]?.values?.[0]?.[0] ?? 0);
	}

	private looksLikeSqlite(buf: Uint8Array): boolean {
		// SQLite files start with the literal "SQLite format 3\0".
		const header = new TextDecoder().decode(buf.slice(0, 15));
		return header === 'SQLite format 3';
	}
}
