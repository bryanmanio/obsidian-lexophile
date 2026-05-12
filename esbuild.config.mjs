import esbuild from 'esbuild';
import { builtinModules } from 'module';
import process from 'process';
import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { copyFile, mkdir } from 'fs/promises';

// Node built-ins to mark external in the bundle. We use `module.builtinModules`
// from Node core instead of the third-party `builtin-modules` package — same
// data, no extra dependency.
const builtins = builtinModules;

const prod = process.argv[2] === 'production';

// Auto-deploy main.js + manifest.json into your vault on every build.
// Resolution order:
//   1. vault-path.txt (gitignored) — single line containing your plugin folder path
//   2. LEXOPHILE_VAULT_PLUGIN_DIR env var
//   3. (none — skip deploy)
function resolveVaultPluginDir() {
	if (existsSync('vault-path.txt')) {
		const p = readFileSync('vault-path.txt', 'utf8').trim();
		if (p) return p;
	}
	return process.env.LEXOPHILE_VAULT_PLUGIN_DIR ?? '';
}

const VAULT_PLUGIN_DIR = resolveVaultPluginDir();

const deployToVault = {
	name: 'deploy-to-vault',
	setup(build) {
		build.onEnd(async (result) => {
			if (result.errors.length > 0) return;
			if (!VAULT_PLUGIN_DIR) {
				console.log('[deploy] no vault-path.txt or LEXOPHILE_VAULT_PLUGIN_DIR — skipping');
				return;
			}
			try {
				await mkdir(VAULT_PLUGIN_DIR, { recursive: true });
				await copyFile('main.js', path.join(VAULT_PLUGIN_DIR, 'main.js'));
				await copyFile('manifest.json', path.join(VAULT_PLUGIN_DIR, 'manifest.json'));
				console.log(`[deploy] copied main.js + manifest.json → ${VAULT_PLUGIN_DIR}`);
			} catch (err) {
				console.error('[deploy] failed:', err.message);
			}
		});
	},
};

const context = await esbuild.context({
	entryPoints: ['src/main.ts'],
	bundle: true,
	external: [
		'obsidian',
		'electron',
		'@codemirror/autocomplete',
		'@codemirror/collab',
		'@codemirror/commands',
		'@codemirror/language',
		'@codemirror/lint',
		'@codemirror/search',
		'@codemirror/state',
		'@codemirror/view',
		'@lezer/common',
		'@lezer/highlight',
		'@lezer/lr',
		...builtins,
	],
	format: 'cjs',
	target: 'es2018',
	logLevel: 'info',
	sourcemap: prod ? false : 'inline',
	treeShaking: true,
	outfile: 'main.js',
	loader: { '.wasm': 'binary' },
	plugins: [deployToVault],
});

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
