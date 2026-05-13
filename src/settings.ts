export type NamingConvention = 'asis' | 'lowercase' | 'titlecase';
export type DuplicateHandling = 'skip' | 'append' | 'overwrite';
export type UnmatchedBookHandling = 'create' | 'linkOnly' | 'plainText';
export type DictionarySource = 'api' | 'local';

export interface DictionarySettings {
	folder: string;
	namingConvention: NamingConvention;
	wordTemplate: string;
	bookTemplate: string;
	port: number;
	apiToken: string;
	duplicateHandling: DuplicateHandling;
	autoCreateBase: boolean;
	baseName: string;
	stubUnfoundWords: boolean;
	dictionarySource: DictionarySource;
	enableKoboImport: boolean;
	booksFolder: string;
	unmatchedBookHandling: UnmatchedBookHandling;
}

export const DEFAULT_WORD_TEMPLATE = `---
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

// Pre-structured book stub in the spirit of Kepano-style frontmatter:
// common book metadata fields with empty values the user fills in later.
export const DEFAULT_BOOK_TEMPLATE = `---
tags: book
type: book
status: unread
author:
series:
rating:
isbn:
date-added: {{date}}
date-finished:
---

# {{title}}
`;

export const DEFAULT_SETTINGS: DictionarySettings = {
	folder: 'Dictionary',
	namingConvention: 'titlecase',
	wordTemplate: DEFAULT_WORD_TEMPLATE,
	bookTemplate: DEFAULT_BOOK_TEMPLATE,
	port: 27124,
	apiToken: '',
	duplicateHandling: 'skip',
	autoCreateBase: true,
	baseName: '_Dictionary List',
	stubUnfoundWords: false,
	dictionarySource: 'api',
	enableKoboImport: false,
	booksFolder: 'Books',
	unmatchedBookHandling: 'create',
};
