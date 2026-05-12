import { promises as fs } from 'fs';
import { getSqlJs } from './sqlite';

export interface KoboWord {
	word: string;
	bookTitle: string | null;
	dateCreated: string;
}

// Strips leading/trailing punctuation, quotes, brackets, dashes, and whitespace
// that often come from imprecise highlighting on the device — "serendipity,"
// becomes "serendipity", "(book." becomes "book". Internal punctuation
// (apostrophes in "don't", hyphens in "well-being") is preserved.
const TRIM_CHARS = /^[\s.,;:!?'"`‘’“”()[\]{}<>—–-]+|[\s.,;:!?'"`‘’“”()[\]{}<>—–-]+$/g;

export function cleanKoboWord(text: string): string {
	if (!text) return '';
	return text.replace(TRIM_CHARS, '').trim();
}

export async function fileExists(filePath: string): Promise<boolean> {
	try {
		const stat = await fs.stat(filePath);
		return stat.isFile();
	} catch {
		return false;
	}
}

export async function readKoboWords(filePath: string): Promise<KoboWord[]> {
	let buf: Buffer;
	try {
		buf = await fs.readFile(filePath);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === 'ENOENT') {
			throw new Error('File not found. Is your Kobo plugged in and mounted?');
		}
		if (code === 'EACCES') {
			throw new Error('Permission denied reading the database file.');
		}
		throw new Error(`Could not read file: ${(err as Error).message}`);
	}

	// SQLite files start with the literal "SQLite format 3\0".
	if (buf.length < 16 || buf.subarray(0, 15).toString('utf8') !== 'SQLite format 3') {
		throw new Error('That file is not a SQLite database.');
	}

	const SQL = await getSqlJs();
	const db = new SQL.Database(new Uint8Array(buf));

	try {
		const stmt = db.prepare(`
			SELECT
				wl.Text       AS word,
				wl.DictSuffix AS lang,
				wl.DateCreated AS dateCreated,
				c.Title       AS bookTitle
			FROM WordList wl
			LEFT JOIN content c ON wl.VolumeId = c.ContentID
			WHERE wl.DictSuffix = '-en' OR wl.DictSuffix IS NULL
			ORDER BY wl.DateCreated DESC
		`);

		const rows: KoboWord[] = [];
		while (stmt.step()) {
			const row = stmt.getAsObject() as { word?: string; bookTitle?: string | null; dateCreated?: string };
			const cleaned = cleanKoboWord(String(row.word ?? ''));
			if (cleaned) {
				rows.push({
					word: cleaned,
					bookTitle: row.bookTitle ? String(row.bookTitle) : null,
					dateCreated: row.dateCreated ? String(row.dateCreated) : '',
				});
			}
		}
		stmt.free();
		return rows;
	} catch (err) {
		const msg = (err as Error).message;
		if (/no such table/i.test(msg)) {
			throw new Error('This SQLite file does not look like a Kobo database (no WordList table).');
		}
		throw err;
	} finally {
		db.close();
	}
}
