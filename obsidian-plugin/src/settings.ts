export type NamingConvention = 'asis' | 'lowercase' | 'titlecase';
export type DuplicateHandling = 'skip' | 'append' | 'overwrite';

export interface DictionarySettings {
	folder: string;
	namingConvention: NamingConvention;
	template: string;
	port: number;
	apiToken: string;
	duplicateHandling: DuplicateHandling;
	autoCreateBase: boolean;
	baseName: string;
}

export const DEFAULT_TEMPLATE = `---
tags: dictionary
date-added: {{date}}
source: "{{source}}"
word-class: "{{partOfSpeech}}"
definition: "{{definition}}"
---

# {{word}}

**Word class:** {{partOfSpeech}}

**Definition:** {{definition}}
`;

export const DEFAULT_SETTINGS: DictionarySettings = {
	folder: 'Dictionary',
	namingConvention: 'asis',
	template: DEFAULT_TEMPLATE,
	port: 27124,
	apiToken: '',
	duplicateHandling: 'skip',
	autoCreateBase: true,
	baseName: '_Dictionary List',
};
