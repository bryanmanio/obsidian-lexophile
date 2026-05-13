// Shared template renderer used by both word notes (lexicon.ts) and book
// stubs (books.ts). Templates are plain Markdown with `{{name}}` variables;
// values inside a YAML frontmatter block are escaped for double-quoted
// scalars, body lines that contain only an empty `**Label:**` are stripped,
// and multiple blank lines collapse to one.

export type TemplateValues = Record<string, string>;

const FRONTMATTER_PATTERN = /^(---\n)([\s\S]*?)(\n---\n?)([\s\S]*)$/;
const PLACEHOLDER_PATTERN = /\{\{(\w+)\}\}/g;
const EMPTY_LABEL_LINE = /^\s*\*\*[^*]+:\*\*\s*$/;
const TRIPLE_NEWLINE = /\n{3,}/g;

export function renderTemplate(
	template: string,
	values: TemplateValues,
	includeFrontmatter = true
): string {
	const fmMatch = FRONTMATTER_PATTERN.exec(template);

	let output: string;
	if (fmMatch) {
		const [, fmStart, fmContent, fmEnd, body] = fmMatch;
		const renderedFm = substitute(fmContent, values, escapeYamlDouble);
		const renderedBody = substitute(body, values, (s) => s);
		output = includeFrontmatter ? fmStart + renderedFm + fmEnd + renderedBody : renderedBody;
	} else {
		output = substitute(template, values, (s) => s);
	}

	return stripEmptyLabelLines(output);
}

function substitute(
	text: string,
	values: TemplateValues,
	transform: (s: string) => string
): string {
	return text.replace(PLACEHOLDER_PATTERN, (match: string, key: string) => {
		if (Object.prototype.hasOwnProperty.call(values, key)) {
			return transform(values[key]);
		}
		return match;
	});
}

// Escape a value for placement inside a YAML double-quoted scalar.
function escapeYamlDouble(value: string): string {
	return (value ?? '')
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"')
		.replace(/\n/g, '\\n')
		.replace(/\r/g, '\\r')
		.replace(/\t/g, '\\t');
}

// Removes body lines that look like "**Label:** " with no value after
// substitution. Frontmatter (key: value) lines are untouched — they don't
// match the **bold** pattern. Triple+ newlines collapse to a single blank.
function stripEmptyLabelLines(content: string): string {
	return content
		.split('\n')
		.filter((line) => !EMPTY_LABEL_LINE.test(line))
		.join('\n')
		.replace(TRIPLE_NEWLINE, '\n\n');
}
