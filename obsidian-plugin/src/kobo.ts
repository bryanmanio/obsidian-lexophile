import { promises as fs } from 'fs';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — esbuild's binary loader resolves this to a Uint8Array
import wasmBinary from 'sql.js/dist/sql-wasm.wasm';

export interface KoboWord {
	word: string;
	bookTitle: string | null;
	dateCreated: string;
}

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

// Lazy-init so plugin load is unaffected for users who never run the import.
function getSqlJs(): Promise<SqlJsStatic> {
	if (!sqlJsPromise) {
		// esbuild's binary loader hands us a Uint8Array; sql.js types want
		// ArrayBuffer but accept either at runtime. Cast through unknown.
		sqlJsPromise = initSqlJs({ wasmBinary: wasmBinary as unknown as ArrayBuffer });
	}
	return sqlJsPromise;
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
	if (buf.length < 16 || buf.slice(0, 15).toString('utf8') !== 'SQLite format 3') {
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
			if (row.word) {
				rows.push({
					word: String(row.word).trim(),
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
