import {
	flattenRule,
	applyDefaults,
	stripDefaults,
	RULE_DEFAULTS,
	ResolvedRule,
} from '../settings'
import { migrateRule } from '../main'

// ── flattenRule ───────────────────────────────────────────────────────────────

describe('flattenRule', () => {
	it('returns empty for non-objects', () => {
		expect(flattenRule(null)).toEqual({})
		expect(flattenRule('string')).toEqual({})
		expect(flattenRule(42)).toEqual({})
		expect(flattenRule([])).toEqual({})
	})

	it('collects top-level known keys', () => {
		const result = flattenRule({ key: 'title', type: 'lines', value: 'foo' })
		expect(result).toMatchObject({ key: 'title', type: 'lines', value: 'foo' })
	})

	it('ignores unknown scalar keys', () => {
		const result = flattenRule({ key: 'x', label: 'ignored', count: 5 })
		expect(result).not.toHaveProperty('label')
		expect(result).not.toHaveProperty('count')
		expect(result).toHaveProperty('key', 'x')
	})

	it('recurses into unknown object keys (user-defined grouping)', () => {
		const result = flattenRule({
			key: 'x',
			input: { match: 'containing', value: 'foo' },
			output: { pull: 'all' },
		})
		expect(result).toMatchObject({ key: 'x', match: 'containing', value: 'foo', pull: 'all' })
	})

	it('does not recurse into arrays', () => {
		const result = flattenRule({ key: 'x', trigger: ['modification', 'open'] })
		expect(result.trigger).toEqual(['modification', 'open'])
	})

	it('skips undefined values', () => {
		const result = flattenRule({ key: 'x', enabled: undefined, pull: 'all' })
		expect(result).not.toHaveProperty('enabled')
		expect(result).toHaveProperty('pull', 'all')
	})

	it('flattens arbitrary nesting depth', () => {
		const result = flattenRule({ key: 'x', a: { b: { c: { value: 'deep' } } } })
		expect(result).toHaveProperty('value', 'deep')
	})

	it('first occurrence of a key wins when duplicated across nesting levels', () => {
		// outer `pull` is a known key and gets collected first
		const result = flattenRule({ key: 'x', pull: 'first', nested: { pull: 'all' } })
		expect(result.pull).toBe('first')
	})
})

// ── applyDefaults ─────────────────────────────────────────────────────────────

describe('applyDefaults', () => {
	it('fills in all defaults when given only a key', () => {
		const rule = applyDefaults({ key: 'test' })
		expect(rule.key).toBe('test')
		expect(rule.enabled).toBe(true)
		expect(rule.type).toBe('lines')
		expect(rule.pull).toBe('first')
		expect(rule.match).toBe('starting_with')
		expect(rule.trigger).toEqual([])
		expect(rule.whererun).toEqual([])
	})

	it('overrides defaults with provided values', () => {
		const rule = applyDefaults({ key: 'x', type: 'between', pull: 'all', enabled: false })
		expect(rule.type).toBe('between')
		expect(rule.pull).toBe('all')
		expect(rule.enabled).toBe(false)
	})

	it('coerces key to string', () => {
		expect(applyDefaults({ key: 123 }).key).toBe('123')
		expect(applyDefaults({}).key).toBe('')
	})

	it('does not override defaults with undefined', () => {
		const rule = applyDefaults({ key: 'x', type: undefined })
		expect(rule.type).toBe('lines') // default, not undefined
	})

	it('retains array values', () => {
		const triggers = ['modification', 'open'] as const
		const rule = applyDefaults({ key: 'x', trigger: [...triggers] })
		expect(rule.trigger).toEqual(triggers)
	})

	it('array defaults are independent copies (push does not affect RULE_DEFAULTS)', () => {
		const rule = applyDefaults({ key: 'x' })
		rule.trigger.push('modification')
		const rule2 = applyDefaults({ key: 'y' })
		expect(rule2.trigger).toEqual([]) // must still be empty
	})
})

// ── stripDefaults ─────────────────────────────────────────────────────────────

describe('stripDefaults', () => {
	it('strips all default values, leaving only key', () => {
		const full = applyDefaults({ key: 'x' })
		const stripped = stripDefaults(full)
		expect(stripped).toEqual({ key: 'x' })
	})

	it('keeps fields that differ from defaults', () => {
		const full = applyDefaults({ key: 'x', type: 'between', pull: 'all', enabled: false })
		const stripped = stripDefaults(full)
		expect(stripped).toMatchObject({ key: 'x', type: 'between', pull: 'all', enabled: false })
		expect(stripped).not.toHaveProperty('match') // default
		expect(stripped).not.toHaveProperty('value') // default
	})

	it('keeps non-empty arrays', () => {
		const full = applyDefaults({ key: 'x', trigger: ['modification'] })
		const stripped = stripDefaults(full)
		expect(stripped.trigger).toEqual(['modification'])
	})

	it('strips empty arrays (they are the default)', () => {
		const full = applyDefaults({ key: 'x', trigger: [] })
		const stripped = stripDefaults(full)
		expect(stripped).not.toHaveProperty('trigger')
	})

	it('round-trips: applyDefaults(flattenRule(stripDefaults(rule))) === rule', () => {
		const original = applyDefaults({
			key: 'test',
			type: 'lines',
			value: '- [ ]',
			pull: 'all',
			trim_whitespace: true,
			trigger: ['modification'],
		})
		const roundTripped = applyDefaults(flattenRule(stripDefaults(original)))
		expect(roundTripped).toEqual(original)
	})
})

// ── migrateRule ───────────────────────────────────────────────────────────────

describe('migrateRule', () => {
	it('passes through already-flat rules unchanged', () => {
		const flat = { key: 'x', type: 'lines', value: '- [ ]', pull: 'all' }
		expect(migrateRule(flat as any)).toMatchObject(flat)
	})

	it('migrates nested lines rule', () => {
		const old = {
			key: 'task', type: 'lines', enabled: true, autoadd: true,
			rule: { pull: 'all', match: 'starting_with', value: '- [ ]', pull_next_line: false }
		}
		const result = migrateRule(old as any)
		expect(result).toMatchObject({
			key: 'task', type: 'lines', enabled: true, autoadd: true,
			pull: 'all', match: 'starting_with', value: '- [ ]', pull_next: false,
		})
		expect(result).not.toHaveProperty('rule')
	})

	it('migrates nested between rule, renaming delimiter fields', () => {
		const old = {
			key: 'highlight', type: 'between',
			rule: { pull: 'all', delimiter: '==', end_delimiter: '', inclusive: false, multiline: false }
		}
		const result = migrateRule(old as any)
		expect(result).toMatchObject({
			key: 'highlight', type: 'between',
			pull: 'all', start: '==', end: '',
		})
		expect(result).not.toHaveProperty('rule')
		expect(result).not.toHaveProperty('delimiter')
	})

	it('migrates nested headings rule, renaming match/value to heading_match/heading_value', () => {
		const old = {
			key: 'head', type: 'headings',
			rule: { pull: 'section', match: 'level', value: 1, include_heading_line: true, include_subheadings: true }
		}
		const result = migrateRule(old as any)
		expect(result).toMatchObject({
			key: 'head', type: 'headings',
			pull: 'section', heading_match: 'level', heading_value: 1,
			include_heading_line: true, include_subheadings: true,
		})
		expect(result).not.toHaveProperty('match')
		expect(result).not.toHaveProperty('value')
	})

	it('migrates nested callouts rule', () => {
		const old = {
			key: 'call', type: 'callouts',
			rule: { pull: 'first', callout_type: '', extract: 'both', include_type_label: false }
		}
		const result = migrateRule(old as any)
		expect(result).toMatchObject({
			key: 'call', type: 'callouts',
			pull: 'first', callout_type: '', extract: 'both',
		})
	})

	it('migrates nested file rule, promoting rule.pull to file_pull', () => {
		const old = {
			key: 'fname', type: 'file',
			rule: { pull: 'name' }
		}
		const result = migrateRule(old as any)
		expect(result).toMatchObject({ key: 'fname', type: 'file', file_pull: 'name' })
		expect(result).not.toHaveProperty('pull')
	})
})
