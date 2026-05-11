export type NamingConvention = 'asis' | 'lowercase' | 'titlecase';
export type DuplicateHandling = 'skip' | 'append' | 'overwrite';
export type UnmatchedBookHandling = 'create' | 'linkOnly' | 'plainText';

export interface DictionarySettings {
	folder: string;
	namingConvention: NamingConvention;
	template: string;
	port: number;
	apiToken: string;
	duplicateHandling: DuplicateHandling;
	autoCreateBase: boolean;
	baseName: string;
	stubUnfoundWords: boolean;
	enableKoboImport: boolean;
	booksFolder: string;
	unmatchedBookHandling: UnmatchedBookHandling;
}

export const DEFAULT_TEMPLATE = `---
tags: dictionary
date-added: {{date}}
source: "{{source}}"
word-class: "{{partOfSpeech}}"
definition: "{{definition}}"
familiarity: {{familiarity}}
---

# {{word}}

**Word class:** {{partOfSpeech}}

**Definition:** {{definition}}
`;

export const DEFAULT_SETTINGS: DictionarySettings = {
	folder: 'Dictionary',
	namingConvention: 'titlecase',
	template: DEFAULT_TEMPLATE,
	port: 27124,
	apiToken: '',
	duplicateHandling: 'skip',
	autoCreateBase: true,
	baseName: '_Dictionary List',
	stubUnfoundWords: false,
	enableKoboImport: false,
	booksFolder: 'Books',
	unmatchedBookHandling: 'create',
};
