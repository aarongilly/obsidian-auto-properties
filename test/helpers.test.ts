import { TFile, TFolder } from 'obsidian'
import {
	stripMarkdown,
	valuesEqual,
	shouldRun,
	applyFormat,
	collectResults,
	extractRegexResult,
} from '../main'
import { applyDefaults } from '../settings'

function mockFile(path = 'folder/note.md'): TFile {
	const f = new TFile()
	f.path = path
	f.basename = path.split('/').pop()!.replace('.md', '')
	f.extension = 'md'
	const parent = new TFolder(); parent.path = path.split('/').slice(0, -1).join('/'); f.parent = parent
	f.stat = { ctime: 1700000000000, mtime: 1700100000000, size: 100 }
	return f
}

// ── stripMarkdown ─────────────────────────────────────────────────────────────

describe('stripMarkdown', () => {
	it('removes bold', () => expect(stripMarkdown('**hello**')).toBe('hello'))
	it('removes italic', () => expect(stripMarkdown('*hello*')).toBe('hello'))
	it('removes strikethrough', () => expect(stripMarkdown('~~hello~~')).toBe('hello'))
	it('removes inline code', () => expect(stripMarkdown('`hello`')).toBe('hello'))

	it('converts wiki link to target', () => {
		expect(stripMarkdown('[[My Note]]')).toBe('My Note')
	})

	it('converts aliased wiki link to alias', () => {
		expect(stripMarkdown('[[Target|Display Text]]')).toBe('Display Text')
	})

	it('converts markdown link to label', () => {
		expect(stripMarkdown('[click here](https://example.com)')).toBe('click here')
	})

	it('removes heading markers', () => {
		expect(stripMarkdown('## Section Title')).toBe('Section Title')
	})

	it('removes list bullets', () => {
		expect(stripMarkdown('- item')).toBe('item')
		expect(stripMarkdown('* item')).toBe('item')
	})

	it('removes blockquote markers', () => {
		expect(stripMarkdown('> quoted text')).toBe('quoted text')
	})

	it('handles combined markdown in one string', () => {
		const result = stripMarkdown('**bold** and [[Note|alias]]')
		expect(result).toBe('bold and alias')
	})

	it('leaves plain text unchanged', () => {
		expect(stripMarkdown('Just plain text')).toBe('Just plain text')
	})
})

// ── valuesEqual ───────────────────────────────────────────────────────────────

describe('valuesEqual', () => {
	it('equal strings', () => expect(valuesEqual('foo', 'foo')).toBe(true))
	it('unequal strings', () => expect(valuesEqual('foo', 'bar')).toBe(false))
	it('equal numbers', () => expect(valuesEqual(5, 5)).toBe(true))
	it('number vs string with same value', () => expect(valuesEqual(5, '5' as any)).toBe(true))
	it('equal arrays', () => expect(valuesEqual(['a', 'b'], ['a', 'b'])).toBe(true))
	it('unequal arrays (different length)', () => expect(valuesEqual(['a'], ['a', 'b'])).toBe(false))
	it('unequal arrays (different content)', () => expect(valuesEqual(['a', 'b'], ['a', 'c'])).toBe(false))
	it('null vs null', () => expect(valuesEqual(null, null)).toBe(true))
	it('null vs value', () => expect(valuesEqual(null, 'x')).toBe(false))
	it('value vs null', () => expect(valuesEqual('x', null)).toBe(false))
	it('array vs string', () => expect(valuesEqual(['a'], 'a')).toBe(false))
})

// ── collectResults ────────────────────────────────────────────────────────────

describe('collectResults', () => {
	it('returns null for empty matches', () => {
		expect(collectResults([], 'first')).toBeNull()
		expect(collectResults([], 'all')).toBeNull()
	})

	it('pull first returns first item', () => {
		expect(collectResults(['a', 'b', 'c'], 'first')).toBe('a')
	})

	it('pull all returns the full array', () => {
		expect(collectResults(['a', 'b'], 'all')).toEqual(['a', 'b'])
	})

	it('pull count returns the number of matches (even if zero)', () => {
		expect(collectResults([], 'count')).toBe(0)
		expect(collectResults(['a', 'b', 'c'], 'count')).toBe(3)
	})

	it('pull text returns first item (headings heading-text mode)', () => {
		expect(collectResults(['First Heading', 'Second Heading'], 'text')).toBe('First Heading')
	})
})

// ── applyFormat ───────────────────────────────────────────────────────────────

describe('applyFormat', () => {
	const f = mockFile('projects/my-note.md')

	it('substitutes ${result}', () => {
		const rule = applyDefaults({ key: 'x', format: 'https://example.com/${result}' })
		expect(applyFormat('my-slug', rule, f)).toBe('https://example.com/my-slug')
	})

	it('substitutes ${filename}', () => {
		const rule = applyDefaults({ key: 'x', format: 'Note: ${filename}' })
		expect(applyFormat('', rule, f)).toBe('Note: my-note')
	})

	it('substitutes ${folder}', () => {
		const rule = applyDefaults({ key: 'x', format: '[${folder}]' })
		expect(applyFormat('', rule, f)).toBe('[projects]')
	})

	it('substitutes ${path}', () => {
		const rule = applyDefaults({ key: 'x', format: '${path}' })
		expect(applyFormat('', rule, f)).toBe('projects/my-note.md')
	})

	it('leaves unknown placeholders unchanged', () => {
		const rule = applyDefaults({ key: 'x', format: '${unknown}' })
		expect(applyFormat('val', rule, f)).toBe('${unknown}')
	})

	it('handles multiple placeholders', () => {
		const rule = applyDefaults({ key: 'x', format: '${folder}/${filename}: ${result}' })
		expect(applyFormat('content', rule, f)).toBe('projects/my-note: content')
	})
})

// ── extractRegexResult ────────────────────────────────────────────────────────

describe('extractRegexResult', () => {
	it('returns the first full regex match', () => {
		const rule = applyDefaults({ key: 'x', result_regex: '\\[[^\\]]+\\]' })
		expect(extractRegexResult('[Value] - Some More Text', rule)).toBe('[Value]')
	})

	it('returns the first capture group when one is present', () => {
		const rule = applyDefaults({ key: 'x', result_regex: '\\[([^\\]]+)\\]' })
		expect(extractRegexResult('[Value] - Some More Text', rule)).toBe('Value')
	})

	it('returns an empty string when there is no match', () => {
		const rule = applyDefaults({ key: 'x', result_regex: '\\[([^\\]]+)\\]' })
		expect(extractRegexResult('Some More Text', rule)).toBe('')
	})

	it('uses normal case-sensitive regex semantics', () => {
		const rule = applyDefaults({ key: 'x', result_regex: '\\[([A-Z]+)\\]' })
		expect(extractRegexResult('[value] - Some More Text', rule)).toBe('')
	})

	it('leaves the result unchanged when the regex is invalid', () => {
		const rule = applyDefaults({ key: 'x', result_regex: '[' })
		expect(extractRegexResult('original value', rule)).toBe('original value')
	})
})

// ── shouldRun ─────────────────────────────────────────────────────────────────

describe('shouldRun', () => {
	const fm: Record<string, unknown> = { title: 'Existing' }
	const f = mockFile('projects/note.md')

	it('returns false when rule is disabled', () => {
		const rule = applyDefaults({ key: 'title', enabled: false, trigger: ['modification'] })
		expect(shouldRun(rule, 'modification', fm, f)).toBe(false)
	})

	it('returns false when trigger does not match', () => {
		const rule = applyDefaults({ key: 'title', trigger: ['open'] })
		expect(shouldRun(rule, 'modification', fm, f)).toBe(false)
	})

	it('returns true when trigger matches', () => {
		const rule = applyDefaults({ key: 'title', trigger: ['modification'] })
		expect(shouldRun(rule, 'modification', fm, f)).toBe(true)
	})

	it('manual trigger always passes the trigger check', () => {
		const rule = applyDefaults({ key: 'title', trigger: ['open'] })
		expect(shouldRun(rule, 'manual', fm, f)).toBe(true)
	})

	it('returns false if key missing and autoadd is false', () => {
		const rule = applyDefaults({ key: 'nonexistent', trigger: ['modification'] })
		expect(shouldRun(rule, 'modification', {}, f)).toBe(false)
	})

	it('returns true if key missing but autoadd is true', () => {
		const rule = applyDefaults({ key: 'newkey', autoadd: true, trigger: ['modification'] })
		expect(shouldRun(rule, 'modification', {}, f)).toBe(true)
	})

	it('whererun: skips file not in the specified folder', () => {
		const rule = applyDefaults({ key: 'title', trigger: ['modification'], whererun: ['work'] })
		expect(shouldRun(rule, 'modification', fm, f)).toBe(false) // f is in 'projects', not 'work'
	})

	it('whererun: allows file in the specified folder', () => {
		const rule = applyDefaults({ key: 'title', trigger: ['modification'], whererun: ['projects'] })
		expect(shouldRun(rule, 'modification', fm, f)).toBe(true)
	})

	it('whererun: matches files in subfolders', () => {
		const deep = mockFile('projects/2024/note.md')
		const rule = applyDefaults({ key: 'title', trigger: ['modification'], whererun: ['projects'] })
		expect(shouldRun(rule, 'modification', fm, deep)).toBe(true)
	})

	it('whereignore: skips file in ignored folder', () => {
		const rule = applyDefaults({ key: 'title', trigger: ['modification'], whereignore: ['projects'] })
		expect(shouldRun(rule, 'modification', fm, f)).toBe(false)
	})

	it('whereignore wins over whererun when both match', () => {
		const rule = applyDefaults({
			key: 'title', trigger: ['modification'],
			whererun: ['projects'],
			whereignore: ['projects'],
		})
		expect(shouldRun(rule, 'modification', fm, f)).toBe(false)
	})
})
