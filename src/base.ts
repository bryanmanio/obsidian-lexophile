import { App, normalizePath } from 'obsidian';
import type { DictionarySettings } from './settings';

export async function ensureDictionaryBase(app: App, settings: DictionarySettings): Promise<void> {
	if (!settings.autoCreateBase) return;

	const folderPath = normalizePath(settings.folder);
	const baseName = (settings.baseName || '_Dictionary List').trim().replace(/[\\/:*?"<>|#^[\]]/g, '');
	if (!baseName) return;

	const basePath = normalizePath(`${folderPath}/${baseName}.base`);
	if (app.vault.getAbstractFileByPath(basePath)) return;

	const content = `filters:
  and:
    - file.inFolder("${folderPath}")
    - file.ext != "base"
properties:
  file.name:
    displayName: Word
  word-class:
    displayName: Word class
  familiarity:
    displayName: Familiarity
  date-added:
    displayName: Date added
views:
  - type: table
    name: All words
    order:
      - file.name
      - word-class
      - definition
      - familiarity
      - source
      - date-added
`;

	await app.vault.create(basePath, content);
}
