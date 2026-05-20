import AutoPropertyPlugin, { stripMarkdown, valuesEqual } from '../main'

// Confirms the test infrastructure compiles and imports resolve.
describe('setup', () => {
	it('imports without throwing', () => {
		expect(typeof stripMarkdown).toBe('function')
	})

	it('stripMarkdown removes bold', () => {
		expect(stripMarkdown('**hello**')).toBe('hello')
	})

	it('valuesEqual handles primitives', () => {
		expect(valuesEqual('foo', 'foo')).toBe(true)
		expect(valuesEqual('foo', 'bar')).toBe(false)
	})

	it('extractBodyLines strips frontmatter', () => {
		const raw = '---\ntitle: test\n---\nBody here'
		expect(AutoPropertyPlugin.extractBodyLines(raw)).toEqual(['Body here'])
	})
})
