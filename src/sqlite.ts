import initSqlJs, { type SqlJsStatic } from 'sql.js';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — esbuild's binary loader resolves this to a Uint8Array
import wasmBinary from 'sql.js/dist/sql-wasm.wasm';

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

// Lazy-initialize sql.js so the WASM compile only happens when something
// actually needs the SQLite runtime (Kobo import, local dictionary lookup).
export function getSqlJs(): Promise<SqlJsStatic> {
	if (!sqlJsPromise) {
		// esbuild's binary loader hands us a Uint8Array; sql.js types want
		// ArrayBuffer but accept either at runtime. Cast through unknown.
		sqlJsPromise = initSqlJs({ wasmBinary: wasmBinary as unknown as ArrayBuffer });
	}
	return sqlJsPromise;
}
