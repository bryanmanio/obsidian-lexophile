import initSqlJs, { type SqlJsStatic } from 'sql.js';
// esbuild's `binary` loader resolves this .wasm import to a Uint8Array at
// build time. A matching declaration in src/types.d.ts gives TypeScript the
// right shape so we don't need a ts-ignore here.
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
