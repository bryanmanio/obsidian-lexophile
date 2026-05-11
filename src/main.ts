import { App, Notice, Plugin, PluginSettingTab, Setting, TFolder, normalizePath } from 'obsidian';
import { DictionaryServer } from './server';
import { DictionaryStore } from './dictionaryStore';
import { AddWordModal } from './wordModal';
import { KoboImportModal } from './koboImportModal';
import { MassImportModal } from './massImportModal';
import { FolderSuggest } from './folderSuggest';
import { DEFAULT_SETTINGS, DEFAULT_TEMPLATE } from './settings';
import type { DictionarySettings } from './settings';

export default class DictionaryPlugin extends Plugin {
	settings: DictionarySettings;
	store: DictionaryStore;
	private server: DictionaryServer;

	async onload() {
		await this.loadSettings();

		this.store = new DictionaryStore(this.app, this);
		// Eager-load is best-effort: a missing file just leaves the store in
		// "not ready" mode, which the settings tab and import modals handle.
		try {
			await this.store.init();
		} catch (err) {
			console.error('[Lexophile] dictionary init failed:', err);
		}

		this.server = new DictionaryServer(
			this.app,
			() => this.settings,
			(msg) => console.log(`[Lexophile] ${msg}`)
		);

		await this.startServer();

		this.addSettingTab(new DictionarySettingTab(this.app, this));

		this.addCommand({
			id: 'add-word',
			name: 'Add word to lexicon',
			callback: () => {
				new AddWordModal(this.app, () => this.settings, this.store).open();
			},
		});

		this.addCommand({
			id: 'mass-import',
			name: 'Mass-import words from a list',
			callback: () => {
				new MassImportModal(this.app, () => this.settings, this.store).open();
			},
		});

		this.addCommand({
			id: 'import-kobo',
			name: 'Import words from Kobo',
			callback: () => {
				if (!this.settings.enableKoboImport) {
					new Notice('Lexophile: enable Kobo import in Settings → Lexophile first.');
					return;
				}
				new KoboImportModal(this.app, () => this.settings, this.store).open();
			},
		});

		this.addCommand({
			id: 'restart-server',
			name: 'Restart local server',
			callback: async () => {
				await this.stopServer();
				await this.startServer();
			},
		});
	}

	async onunload() {
		await this.stopServer();
		this.store?.close();
	}

	async startServer() {
		try {
			await this.server.start(this.settings.port);
			new Notice(`Lexophile: server running on port ${this.settings.port}`);
		} catch (err) {
			new Notice(`Lexophile: failed to start server — ${(err as Error).message}`);
			console.error('[Lexophile]', err);
		}
	}

	async stopServer() {
		if (this.server?.isRunning()) {
			await this.server.stop();
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class DictionarySettingTab extends PluginSettingTab {
	plugin: DictionaryPlugin;

	constructor(app: App, plugin: DictionaryPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Lexophile' });

		// ── How to add words ─────────────────────────────────────────

		const usage = containerEl.createDiv({ cls: 'lexophile-usage' });
		usage.style.cssText =
			'background:#f5f0fc; border-left:3px solid #7d53dc; padding:12px 14px; border-radius:4px; margin-bottom:18px; color:#3d2a6f; font-size:13px; line-height:1.5;';
		usage.createEl('strong', { text: 'How to add words' });
		const list = usage.createEl('ul');
		list.style.cssText = 'margin:8px 0 0; padding-left:20px;';
		const fromObsidian = list.createEl('li');
		fromObsidian.appendText('From Obsidian: open the command palette and run ');
		fromObsidian.createEl('strong', { text: 'Lexophile: Add word to lexicon' });
		fromObsidian.appendText('. Type or paste a word, press Enter.');
		const fromBrowser = list.createEl('li');
		fromBrowser.appendText('From the web: install the Lexophile Chrome extension, highlight a word, right-click, and choose ');
		fromBrowser.createEl('strong', { text: 'Add "<word>" to Lexophile' });
		fromBrowser.appendText('.');

		// ── Dictionary source ────────────────────────────────────────

		containerEl.createEl('h3', { text: 'Dictionary source' });

		new Setting(containerEl)
			.setName('Where to look up definitions')
			.setDesc('Online uses the Free Dictionary API. Local downloads a one-time 23MB SQLite and works offline thereafter.')
			.addDropdown((drop) =>
				drop
					.addOption('api', 'Online (Free Dictionary API)')
					.addOption('local', 'Local SQLite (offline)')
					.setValue(this.plugin.settings.dictionarySource)
					.onChange(async (value) => {
						this.plugin.settings.dictionarySource = value as DictionarySettings['dictionarySource'];
						await this.plugin.saveSettings();
						this.display();
					})
			);

		if (this.plugin.settings.dictionarySource === 'api') {
			const apiNote = containerEl.createEl('p', { cls: 'setting-item-description' });
			apiNote.appendText('Lookups go to ');
			apiNote.createEl('code', { text: 'api.dictionaryapi.dev' });
			apiNote.appendText('. Free public API, occasionally rate-limited — switch to Local for an offline mode.');
		} else {
			const dictIntro = containerEl.createEl('p', { cls: 'setting-item-description' });
			dictIntro.appendText(
				'Local SQLite (~23MB, ~167K English entries from Wiktionary via '
			);
			dictIntro.createEl('a', {
				text: 'MattDodsonEnglish/english-dictionary',
				href: 'https://github.com/MattDodsonEnglish/english-dictionary',
			});
			dictIntro.appendText('). Downloads once on first use — no network calls during normal use after that.');

			const dictStatus = containerEl.createDiv();
			dictStatus.style.cssText =
				'padding: 10px 12px; margin: 4px 0 12px; background: var(--background-secondary); border-radius: 6px; font-size: 13px;';
			this.renderDictionaryStatus(dictStatus);

			new Setting(containerEl)
				.setName('Dictionary download URL')
				.setDesc('Where the dictionary SQLite is downloaded from. Override only if mirroring or using a custom build.')
				.addText((text) => {
					text
						.setPlaceholder('https://…/dictionary.sqlite')
						.setValue(this.plugin.settings.dictionaryUrl)
						.onChange(async (value) => {
							this.plugin.settings.dictionaryUrl = value;
							await this.plugin.saveSettings();
						});
					text.inputEl.style.cssText = 'width: 100%; font-family: monospace; font-size: 12px;';
				});
		}

		// ── Note creation ────────────────────────────────────────────

		new Setting(containerEl)
			.setName('Dictionary folder')
			.setDesc('Folder where new notes will be created. Created automatically if it does not exist.')
			.addText((text) =>
				text
					.setPlaceholder('Dictionary')
					.setValue(this.plugin.settings.folder)
					.onChange(async (value) => {
						this.plugin.settings.folder = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Note naming')
			.setDesc('How to capitalize the note filename.')
			.addDropdown((drop) =>
				drop
					.addOption('asis', 'As-is')
					.addOption('lowercase', 'lowercase')
					.addOption('titlecase', 'Title Case')
					.setValue(this.plugin.settings.namingConvention)
					.onChange(async (value) => {
						this.plugin.settings.namingConvention = value as DictionarySettings['namingConvention'];
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Duplicate handling')
			.setDesc('What to do when a note for the word already exists.')
			.addDropdown((drop) =>
				drop
					.addOption('skip', 'Skip — keep existing note')
					.addOption('append', 'Append new definition')
					.addOption('overwrite', 'Overwrite')
					.setValue(this.plugin.settings.duplicateHandling)
					.onChange(async (value) => {
						this.plugin.settings.duplicateHandling = value as DictionarySettings['duplicateHandling'];
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Create stubs for unknown words')
			.setDesc(
				'When the dictionary has no entry for a word (a name, slang, technical term), save a stub note with empty fields instead of failing. You can fill in the definition later.'
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.stubUnfoundWords).onChange(async (value) => {
					this.plugin.settings.stubUnfoundWords = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('Automatically create dictionary base')
			.setDesc('Create a Bases file in the dictionary folder that lists every word in a table view.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoCreateBase).onChange(async (value) => {
					this.plugin.settings.autoCreateBase = value;
					await this.plugin.saveSettings();
					this.display();
				})
			);

		if (this.plugin.settings.autoCreateBase) {
			new Setting(containerEl)
				.setName('Base name')
				.setDesc('Filename (without extension) for the auto-created base.')
				.addText((text) =>
					text
						.setPlaceholder('_Dictionary List')
						.setValue(this.plugin.settings.baseName)
						.onChange(async (value) => {
							this.plugin.settings.baseName = value;
							await this.plugin.saveSettings();
						})
				);
		}

		// ── Kobo eReader import ──────────────────────────────────────

		containerEl.createEl('h3', { text: 'Kobo eReader import' });

		const koboIntro = containerEl.createEl('p', { cls: 'setting-item-description' });
		koboIntro.appendText('Import words you saved on your Kobo. Plug your Kobo into your computer, then run ');
		koboIntro.createEl('strong', { text: 'Lexophile: Import words from Kobo' });
		koboIntro.appendText(' from the command palette. Each word becomes a dictionary note; its source links back to the book it came from in your library.');

		new Setting(containerEl)
			.setName('Enable Kobo import')
			.setDesc('Reveals the Kobo settings and unlocks the import command.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.enableKoboImport).onChange(async (value) => {
					this.plugin.settings.enableKoboImport = value;
					await this.plugin.saveSettings();
					this.display();
				})
			);

		if (this.plugin.settings.enableKoboImport) {
			const booksFolderPath = normalizePath(this.plugin.settings.booksFolder || 'Books');
			const folderExists = this.app.vault.getAbstractFileByPath(booksFolderPath) instanceof TFolder;

			new Setting(containerEl)
				.setName('Books folder')
				.setDesc(
					folderExists
						? `✓ Folder exists at "${booksFolderPath}". New book notes will be created here.`
						: `"${booksFolderPath}" doesn't exist yet. Create it below or pick another folder.`
				)
				.addText((text) => {
					text
						.setPlaceholder('Books')
						.setValue(this.plugin.settings.booksFolder)
						.onChange(async (value) => {
							this.plugin.settings.booksFolder = value;
							await this.plugin.saveSettings();
							this.display();
						});
					new FolderSuggest(this.app, text.inputEl, ['Books']);
				});

			if (!folderExists) {
				new Setting(containerEl)
					.setName('Create books folder')
					.setDesc(`Creates "${booksFolderPath}" so wikilinks resolve.`)
					.addButton((btn) =>
						btn.setButtonText('Create folder').setCta().onClick(async () => {
							try {
								await this.app.vault.createFolder(booksFolderPath);
								new Notice(`Lexophile: created "${booksFolderPath}".`);
								this.display();
							} catch (err) {
								new Notice(`Lexophile: ${(err as Error).message}`);
							}
						})
					);
			}

			new Setting(containerEl)
				.setName("When a book isn't in your library")
				.setDesc('What to do during import if the chosen book name has no matching note in the books folder.')
				.addDropdown((drop) =>
					drop
						.addOption('create', 'Auto-create a stub book note')
						.addOption('linkOnly', 'Link without creating (red wikilinks)')
						.addOption('plainText', 'Use plain text source instead')
						.setValue(this.plugin.settings.unmatchedBookHandling)
						.onChange(async (value) => {
							this.plugin.settings.unmatchedBookHandling = value as DictionarySettings['unmatchedBookHandling'];
							await this.plugin.saveSettings();
						})
				);
		}

		// ── Server ───────────────────────────────────────────────────

		containerEl.createEl('h3', { text: 'Local server' });

		new Setting(containerEl)
			.setName('Port')
			.setDesc('Port the plugin listens on. Requires a server restart to take effect.')
			.addText((text) =>
				text
					.setPlaceholder('27124')
					.setValue(String(this.plugin.settings.port))
					.onChange(async (value) => {
						const port = parseInt(value, 10);
						if (!isNaN(port) && port > 1023 && port < 65536) {
							this.plugin.settings.port = port;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName('API token')
			.setDesc('Secret the Chrome extension must send. Leave blank to disable auth (not recommended).')
			.addText((text) => {
				text
					.setPlaceholder('leave blank to disable')
					.setValue(this.plugin.settings.apiToken)
					.onChange(async (value) => {
						this.plugin.settings.apiToken = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.type = 'password';
			});

		new Setting(containerEl)
			.setName('Restart server')
			.setDesc('Apply port changes by restarting the local server.')
			.addButton((btn) =>
				btn.setButtonText('Restart').onClick(async () => {
					await this.plugin.stopServer();
					await this.plugin.startServer();
				})
			);

		// ── Template ─────────────────────────────────────────────────

		containerEl.createEl('h3', { text: 'Note template' });

		containerEl.createEl('p', {
			text: 'Variables: {{word}}, {{partOfSpeech}}, {{definition}}, {{example}}, {{date}}, {{source}}',
			cls: 'setting-item-description',
		});

		const textareaWrap = containerEl.createDiv();
		textareaWrap.style.marginBottom = '8px';

		const textarea = textareaWrap.createEl('textarea');
		textarea.rows = 16;
		textarea.value = this.plugin.settings.template;
		textarea.style.cssText = 'width:100%; font-family:monospace; font-size:12px; resize:vertical;';
		textarea.addEventListener('input', async () => {
			this.plugin.settings.template = textarea.value;
			await this.plugin.saveSettings();
		});

		new Setting(containerEl).addButton((btn) =>
			btn.setButtonText('Reset to default').onClick(async () => {
				this.plugin.settings.template = DEFAULT_TEMPLATE;
				await this.plugin.saveSettings();
				textarea.value = DEFAULT_TEMPLATE;
			})
		);

		// ── Feedback ─────────────────────────────────────────────────

		const support = containerEl.createEl('p', { cls: 'setting-item-description' });
		support.appendText('Need support? ');
		support.createEl('a', {
			text: 'File an issue on GitHub',
			href: 'https://github.com/bryanmanio/obsidian-lexophile/issues/new',
		});
		support.appendText('.');

		const bmcWrap = containerEl.createEl('p');
		bmcWrap.style.marginTop = '14px';
		const bmcLink = bmcWrap.createEl('a', {
			href: 'https://buymeacoffee.com/bryanmanio',
		});
		bmcLink.setAttr('target', '_blank');
		bmcLink.setAttr('rel', 'noopener');
		const bmcImg = bmcLink.createEl('img');
		bmcImg.src = 'https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png';
		bmcImg.alt = 'Buy Me A Coffee';
		bmcImg.style.cssText = 'height: 40px; width: auto; border-radius: 8px;';
	}

	// Renders the dictionary status pill + download/redownload button into the
	// given container. Kept on the settings tab class so it can re-render
	// itself after a download finishes without rebuilding the whole pane.
	private async renderDictionaryStatus(container: HTMLElement) {
		container.empty();

		const status = await this.plugin.store.status();

		const row = container.createDiv();
		row.style.cssText = 'display: flex; align-items: center; gap: 12px;';

		const pill = row.createSpan();
		pill.style.cssText = 'font-weight: 600; padding: 2px 10px; border-radius: 12px; font-size: 12px;';
		if (status.ready) {
			pill.style.background = 'var(--background-modifier-success)';
			pill.style.color = 'var(--text-on-accent)';
			pill.textContent = 'Ready';
		} else if (status.sizeBytes !== null) {
			pill.style.background = 'var(--background-modifier-border)';
			pill.style.color = 'var(--text-muted)';
			pill.textContent = 'Downloaded, not loaded';
		} else {
			pill.style.background = 'var(--background-modifier-error)';
			pill.style.color = 'var(--text-on-accent)';
			pill.textContent = 'Not downloaded';
		}

		const detail = row.createDiv();
		detail.style.cssText = 'flex: 1; color: var(--text-muted); font-size: 12px;';
		if (status.ready && status.entryCount !== null) {
			const mb = status.sizeBytes ? (status.sizeBytes / 1024 / 1024).toFixed(1) : '?';
			detail.textContent = `${status.entryCount.toLocaleString()} entries · ${mb}MB on disk`;
		} else {
			detail.textContent = 'Click Download to fetch the dictionary file.';
		}

		const btn = row.createEl('button');
		btn.textContent = status.ready ? 'Re-download' : 'Download';
		if (status.ready) btn.style.background = 'transparent';
		btn.addEventListener('click', async () => {
			const url = this.plugin.settings.dictionaryUrl;
			if (!url) {
				new Notice('Lexophile: set a Dictionary download URL first.');
				return;
			}
			btn.disabled = true;
			btn.textContent = 'Downloading…';
			try {
				await this.plugin.store.download(url);
				new Notice('Lexophile: dictionary downloaded and loaded.');
			} catch (err) {
				new Notice(`Lexophile: download failed — ${(err as Error).message}`);
			} finally {
				await this.renderDictionaryStatus(container);
			}
		});
	}
}
