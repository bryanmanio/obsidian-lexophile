import * as http from 'http';
import { App } from 'obsidian';
import { createWordNote, type WordEntry } from './lexicon';
import type { DictionarySettings } from './settings';

export class DictionaryServer {
	private server: http.Server | null = null;
	private app: App;
	private getSettings: () => DictionarySettings;
	private log: (msg: string) => void;

	constructor(app: App, getSettings: () => DictionarySettings, log: (msg: string) => void) {
		this.app = app;
		this.getSettings = getSettings;
		this.log = log;
	}

	start(port: number): Promise<void> {
		return new Promise((resolve, reject) => {
			this.server = http.createServer((req, res) => {
				this.handleRequest(req, res).catch((err) => {
					this.log(`Unhandled request error: ${err}`);
					if (!res.headersSent) {
						res.writeHead(500, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ error: 'Internal server error' }));
					}
				});
			});

			this.server.on('error', (err: NodeJS.ErrnoException) => {
				if (err.code === 'EADDRINUSE') {
					reject(new Error(`Port ${port} is already in use. Change the port in plugin settings.`));
				} else {
					reject(err);
				}
			});

			this.server.listen(port, '127.0.0.1', () => {
				this.log(`Listening on port ${port}`);
				resolve();
			});
		});
	}

	stop(): Promise<void> {
		return new Promise((resolve) => {
			if (!this.server) {
				resolve();
				return;
			}
			this.server.close(() => {
				this.server = null;
				this.log('Server stopped');
				resolve();
			});
		});
	}

	isRunning(): boolean {
		return this.server !== null && this.server.listening;
	}

	private setCorsHeaders(res: http.ServerResponse) {
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
	}

	private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		this.setCorsHeaders(res);

		if (req.method === 'OPTIONS') {
			res.writeHead(204);
			res.end();
			return;
		}

		// Health check — validates token if one is configured, so the Chrome
		// onboarding can confirm both reachability and correct auth.
		if (req.method === 'GET' && req.url === '/health') {
			const settings = this.getSettings();
			const authRequired = Boolean(settings.apiToken);
			let authValid = true;
			if (authRequired) {
				authValid = req.headers['authorization'] === `Bearer ${settings.apiToken}`;
			}
			res.writeHead(authValid ? 200 : 401, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({
				status: authValid ? 'ok' : 'unauthorized',
				plugin: 'lexophile',
				authRequired,
			}));
			return;
		}

		if (req.method !== 'POST' || req.url !== '/word') {
			res.writeHead(404, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'Not found' }));
			return;
		}

		const settings = this.getSettings();

		if (settings.apiToken) {
			const auth = req.headers['authorization'];
			if (auth !== `Bearer ${settings.apiToken}`) {
				res.writeHead(401, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: 'Unauthorized' }));
				return;
			}
		}

		const body = await this.readBody(req);
		let entry: WordEntry;

		try {
			entry = JSON.parse(body);
		} catch {
			res.writeHead(400, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'Invalid JSON' }));
			return;
		}

		if (!entry.word?.trim() || !entry.definition?.trim()) {
			res.writeHead(400, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'word and definition are required' }));
			return;
		}

		const result = await createWordNote(this.app, settings, entry);
		this.log(`${result.action}: "${entry.word}" → ${result.path}`);
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify(result));
	}

	private readBody(req: http.IncomingMessage): Promise<string> {
		return new Promise((resolve, reject) => {
			let body = '';
			req.on('data', (chunk) => {
				body += chunk.toString();
			});
			req.on('end', () => resolve(body));
			req.on('error', reject);
		});
	}
}
