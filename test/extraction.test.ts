/// <reference types="jest" />
import { TFile, TFolder } from 'obsidian'
import AutoPropertyPlugin from '../main'
import { applyDefaults } from '../settings'

// Helper: minimal TFile mock
function mockFile(overrides: Partial<TFile> = {}): TFile {
	const f = new TFile()
	f.path = 'folder/note.md'
	f.basename = 'note'
	f.extension = 'md'
	const folder = new TFolder(); folder.path = 'folder'; f.parent = folder
	f.stat = { ctime: 0, mtime: 0, size: 500 }
	return Object.assign(f, overrides)
}

const file = mockFile()

// ── extractBodyLines ──────────────────────────────────────────────────────────

describe('extractBodyLines', () => {
	it('returns all lines when no frontmatter', () => {
		expect(AutoPropertyPlugin.extractBodyLines('line one\nline two')).toEqual(['line one', 'line two'])
	})

	it('strips frontmatter block', () => {
		const raw = '---\ntitle: foo\ntags: [a]\n---\nBody line'
		expect(AutoPropertyPlugin.extractBodyLines(raw)).toEqual(['Body line'])
	})

	it('handles Windows line endings', () => {
		const raw = '---\r\nkey: val\r\n---\r\nContent'
		expect(AutoPropertyPlugin.extractBodyLines(raw)).toEqual(['Content'])
	})

	it('returns all lines if opening --- is absent', () => {
		const raw = 'title: foo\nBody'
		expect(AutoPropertyPlugin.extractBodyLines(raw)).toEqual(['title: foo', 'Body'])
	})
})

// ── lines type ────────────────────────────────────────────────────────────────

describe('evaluateRule: lines', () => {
	const lines = [
		'- [ ] Buy milk',
		'- [ ] Walk dog',
		'- [x] Read book',
		'Some other line',
		'  - [ ] Indented task',
	]

	it('returns first line starting with value', () => {
		const rule = applyDefaults({ key: 'task', value: '- [ ]' })
		expect(AutoPropertyPlugin.evaluateRule(rule, lines, file)).toBe('- [ ] Buy milk')
	})

	it('returns all matching lines', () => {
		const rule = applyDefaults({ key: 'task', value: '- [ ]', pull: 'all' })
		expect(AutoPropertyPlugin.evaluateRule(rule, lines, file))
			.toEqual(['- [ ] Buy milk', '- [ ] Walk dog'])
	})

	it('returns count of matching lines', () => {
		const rule = applyDefaults({ key: 'task', value: '- [ ]', pull: 'count' })
		expect(AutoPropertyPlugin.evaluateRule(rule, lines, file)).toBe(2)
	})

	it('returns null when no lines match', () => {
		const rule = applyDefaults({ key: 'task', value: 'NOPE' })
		expect(AutoPropertyPlugin.evaluateRule(rule, lines, file)).toBeNull()
	})

	it('omit_match strips the search value from results', () => {
		const rule = applyDefaults({ key: 'task', value: '- [ ]', omit_match: true, trim_whitespace: true })
		expect(AutoPropertyPlugin.evaluateRule(rule, lines, file)).toBe('Buy milk')
	})

	it('pull_next returns the line after the match', () => {
		const body = ['Label:', 'The actual value', 'Other stuff']
		const rule = applyDefaults({ key: 'x', value: 'Label:', pull_next: true })
		expect(AutoPropertyPlugin.evaluateRule(rule, body, file)).toBe('The actual value')
	})

	it('ignore_indentation matches indented lines', () => {
		const rule = applyDefaults({ key: 'task', value: '- [ ]', pull: 'all', ignore_indentation: true })
		expect(AutoPropertyPlugin.evaluateRule(rule, lines, file))
			.toEqual(['- [ ] Buy milk', '- [ ] Walk dog', '  - [ ] Indented task'])
	})

	it('containing match', () => {
		const rule = applyDefaults({ key: 'x', value: 'other', match: 'containing', case_sensitive: false })
		expect(AutoPropertyPlugin.evaluateRule(rule, lines, file)).toBe('Some other line')
	})

	it('regex match', () => {
		const rule = applyDefaults({ key: 'x', value: '- \\[.\\]', match: 'regex', pull: 'all' })
		expect(AutoPropertyPlugin.evaluateRule(rule, lines, file)).toHaveLength(4) // [ ], [ ], [x], indented [ ]
	})
})

// ── between type ──────────────────────────────────────────────────────────────

describe('evaluateRule: between', () => {
	const lines = [
		'This is ==highlight one== and ==highlight two== on one line.',
		'No highlights here.',
		'Another ==third highlight==.',
	]

	it('extracts first match between delimiters', () => {
		const rule = applyDefaults({ key: 'h', type: 'between', start: '==' })
		expect(AutoPropertyPlugin.evaluateRule(rule, lines, file)).toBe('highlight one')
	})

	it('extracts all matches across all lines', () => {
		const rule = applyDefaults({ key: 'h', type: 'between', start: '==', pull: 'all' })
		expect(AutoPropertyPlugin.evaluateRule(rule, lines, file))
			.toEqual(['highlight one', 'highlight two', 'third highlight'])
	})

	it('counts matches', () => {
		const rule = applyDefaults({ key: 'h', type: 'between', start: '==', pull: 'count' })
		expect(AutoPropertyPlugin.evaluateRule(rule, lines, file)).toBe(3)
	})

	it('inclusive mode includes the delimiters', () => {
		const rule = applyDefaults({ key: 'h', type: 'between', start: '==', inclusive: true })
		expect(AutoPropertyPlugin.evaluateRule(rule, lines, file)).toBe('==highlight one==')
	})

	it('different start and end delimiters', () => {
		const body = ['Value: {extracted content} more text']
		const rule = applyDefaults({ key: 'v', type: 'between', start: '{', end: '}' })
		expect(AutoPropertyPlugin.evaluateRule(rule, body, file)).toBe('extracted content')
	})

	it('multiline mode spans across lines', () => {
		const body = ['Start of [', 'middle content', 'end of ] text']
		const rule = applyDefaults({ key: 'v', type: 'between', start: '[', end: ']', multiline: true })
		expect(AutoPropertyPlugin.evaluateRule(rule, body, file)).toBe('\nmiddle content\nend of ')
	})

	it('returns null when delimiter is not found', () => {
		const rule = applyDefaults({ key: 'h', type: 'between', start: '**' })
		expect(AutoPropertyPlugin.evaluateRule(rule, lines, file)).toBeNull()
	})
})

// ── headings type ─────────────────────────────────────────────────────────────

describe('evaluateRule: headings', () => {
	const lines = [
		'# First Heading',
		'Content under H1.',
		'## Sub Heading',
		'Sub content.',
		'# Second Heading',
		'Second content.',
	]

	it('returns heading text for first H1', () => {
		const rule = applyDefaults({ key: 'title', type: 'headings', pull: 'text', heading_match: 'level', heading_value: 1 })
		expect(AutoPropertyPlugin.evaluateRule(rule, lines, file)).toBe('First Heading')
	})

	it('returns full section content for first H1', () => {
		const rule = applyDefaults({ key: 'body', type: 'headings', pull: 'first', heading_match: 'level', heading_value: 1, include_subheadings: true })
		const result = AutoPropertyPlugin.evaluateRule(rule, lines, file) as string
		expect(result).toContain('Content under H1')
		expect(result).toContain('Sub content')
	})

	it('excludes subheadings content when include_subheadings is false', () => {
		const rule = applyDefaults({ key: 'body', type: 'headings', pull: 'first', heading_match: 'level', heading_value: 1, include_subheadings: false })
		const result = AutoPropertyPlugin.evaluateRule(rule, lines, file) as string
		expect(result).toContain('Content under H1')
		expect(result).not.toContain('Sub content')
	})

	it('includes heading line when include_heading_line is true', () => {
		const rule = applyDefaults({ key: 'body', type: 'headings', pull: 'first', heading_match: 'level', heading_value: 1, include_heading_line: true })
		const result = AutoPropertyPlugin.evaluateRule(rule, lines, file) as string
		expect(result).toMatch(/^# First Heading/)
	})

	it('matches heading by text', () => {
		const rule = applyDefaults({ key: 'sub', type: 'headings', pull: 'text', heading_match: 'text', heading_value: 'Sub Heading' })
		expect(AutoPropertyPlugin.evaluateRule(rule, lines, file)).toBe('Sub Heading')
	})

	it('returns all heading texts', () => {
		const rule = applyDefaults({ key: 'titles', type: 'headings', pull: 'all', heading_match: 'level', heading_value: 1 })
		expect(AutoPropertyPlugin.evaluateRule(rule, lines, file)).toEqual(['Content under H1.', 'Second content.'])
	})

	it('counts matching headings', () => {
		const rule = applyDefaults({ key: 'n', type: 'headings', pull: 'count', heading_match: 'level', heading_value: 1 })
		expect(AutoPropertyPlugin.evaluateRule(rule, lines, file)).toBe(2)
	})

	it('returns null when no heading matches', () => {
		const rule = applyDefaults({ key: 'x', type: 'headings', pull: 'text', heading_match: 'level', heading_value: 6 })
		expect(AutoPropertyPlugin.evaluateRule(rule, lines, file)).toBeNull()
	})
})

// ── callouts type ─────────────────────────────────────────────────────────────

describe('evaluateRule: callouts', () => {
	const lines = [
		'> [!warning] Watch out',
		'> This is the warning body.',
		'> Second body line.',
		'Normal line.',
		'> [!info] FYI',
		'> Info body.',
	]

	it('extracts first callout body', () => {
		const rule = applyDefaults({ key: 'c', type: 'callouts' })
		expect(AutoPropertyPlugin.evaluateRule(rule, lines, file)).toBe('This is the warning body.\nSecond body line.')
	})

	it('extracts callout header only', () => {
		const rule = applyDefaults({ key: 'c', type: 'callouts', extract: 'header' })
		expect(AutoPropertyPlugin.evaluateRule(rule, lines, file)).toBe('Watch out')
	})

	it('extracts both header and body', () => {
		const rule = applyDefaults({ key: 'c', type: 'callouts', extract: 'both' })
		const result = AutoPropertyPlugin.evaluateRule(rule, lines, file) as string
		expect(result).toContain('Watch out')
		expect(result).toContain('This is the warning body')
	})

	it('filters by callout type', () => {
		const rule = applyDefaults({ key: 'c', type: 'callouts', callout_type: 'info', extract: 'header' })
		expect(AutoPropertyPlugin.evaluateRule(rule, lines, file)).toBe('FYI')
	})

	it('returns all callouts', () => {
		const rule = applyDefaults({ key: 'c', type: 'callouts', pull: 'all', extract: 'header' })
		expect(AutoPropertyPlugin.evaluateRule(rule, lines, file)).toEqual(['Watch out', 'FYI'])
	})

	it('counts callouts', () => {
		const rule = applyDefaults({ key: 'c', type: 'callouts', pull: 'count' })
		expect(AutoPropertyPlugin.evaluateRule(rule, lines, file)).toBe(2)
	})

	it('include_type_label includes the > [!type] line', () => {
		const rule = applyDefaults({ key: 'c', type: 'callouts', extract: 'header', include_type_label: true })
		expect(AutoPropertyPlugin.evaluateRule(rule, lines, file)).toBe('> [!warning] Watch out')
	})
})

// ── file type ─────────────────────────────────────────────────────────────────

describe('evaluateRule: file', () => {
	const namedFile = mockFile({
		path: 'projects/my-note.md',
		basename: 'my-note',
		extension: 'md',
		parent: Object.assign(new TFolder(), { path: 'projects' }),
		stat: { ctime: 1700000000000, mtime: 1700100000000, size: 2048 },
	})

	it('returns file name', () => {
		const rule = applyDefaults({ key: 'fname', type: 'file', file_pull: 'name' })
		expect(AutoPropertyPlugin.evaluateRule(rule, [], namedFile)).toBe('my-note')
	})

	it('returns full path', () => {
		const rule = applyDefaults({ key: 'fpath', type: 'file', file_pull: 'path' })
		expect(AutoPropertyPlugin.evaluateRule(rule, [], namedFile)).toBe('projects/my-note.md')
	})

	it('returns folder', () => {
		const rule = applyDefaults({ key: 'folder', type: 'file', file_pull: 'folder' })
		expect(AutoPropertyPlugin.evaluateRule(rule, [], namedFile)).toBe('projects')
	})

	it('returns extension', () => {
		const rule = applyDefaults({ key: 'ext', type: 'file', file_pull: 'extension' })
		expect(AutoPropertyPlugin.evaluateRule(rule, [], namedFile)).toBe('md')
	})

	it('returns file size', () => {
		const rule = applyDefaults({ key: 'size', type: 'file', file_pull: 'size' })
		expect(AutoPropertyPlugin.evaluateRule(rule, [], namedFile)).toBe(2048)
	})

	it('returns created date as ISO-style string', () => {
		const rule = applyDefaults({ key: 'created', type: 'file', file_pull: 'created' })
		const result = AutoPropertyPlugin.evaluateRule(rule, [], namedFile) as string
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
	})
})
