import { App, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { DictionaryServer } from './server';
import { AddWordModal } from './wordModal';
import { DEFAULT_SETTINGS, DEFAULT_TEMPLATE } from './settings';
import type { DictionarySettings } from './settings';

export default class DictionaryPlugin extends Plugin {
	settings: DictionarySettings;
	private server: DictionaryServer;

	async onload() {
		await this.loadSettings();

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
				new AddWordModal(this.app, () => this.settings).open();
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

		containerEl.createEl('h3', { text: 'Feedback & support' });
		const feedback = containerEl.createEl('p', { cls: 'setting-item-description' });
		feedback.appendText('Feature requests or support: ');
		feedback.createEl('a', {
			text: 'lexophile@fastmail.com',
			href: 'mailto:lexophile@fastmail.com',
		});
	}
}
