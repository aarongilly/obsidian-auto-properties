import { App, Notice, PluginSettingTab, Setting, setIcon } from 'obsidian'

// ── Avoid circular import from main.ts ───────────────────────────────────────

interface IAutoPropertyPlugin {
	settings: AutoPropertyPluginSettings
	saveSettings(): Promise<void>
}

// ── Primitive types ───────────────────────────────────────────────────────────

export type RuleType     = 'lines' | 'between' | 'headings' | 'callouts' | 'file'
export type Trigger      = 'modification' | 'focus_change' | 'open'
export type Pull         = 'first' | 'all' | 'count' | 'text'
export type LineMatch    = 'starting_with' | 'ending_with' | 'containing' | 'regex'
export type HeadingMatch = 'text' | 'level'
export type FilePull     = 'created' | 'modified' | 'size' | 'path' | 'folder' | 'name' | 'extension'
export type CalloutExtract = 'header' | 'body' | 'both'

// ── Plugin settings ───────────────────────────────────────────────────────────

export interface AutoPropertyPluginSettings {
	rules: AutoPropertyRule[]
	showNotices: boolean
}

// ── Flat user-facing rule (all optional except key) ───────────────────────────

export interface AutoPropertyRule {
	key: string
	enabled?: boolean
	autoadd?: boolean
	no_overwrite?: boolean
	trigger?: Trigger[]
	whererun?: string[]
	whereignore?: string[]
	strip_markdown?: boolean
	trim_whitespace?: boolean
	case_sensitive?: boolean
	format?: string
	type?: RuleType
	// lines
	match?: LineMatch
	value?: string
	pull?: Pull
	pull_next?: boolean
	omit_match?: boolean
	ignore_indentation?: boolean
	// between
	start?: string
	end?: string
	inclusive?: boolean
	multiline?: boolean
	// headings
	heading_match?: HeadingMatch
	heading_value?: string | number
	include_heading_line?: boolean
	include_subheadings?: boolean
	// callouts
	callout_type?: string
	extract?: CalloutExtract
	include_type_label?: boolean
	// file
	file_pull?: FilePull
}

// ── Resolved rule (all required; produced by applyDefaults) ──────────────────

export interface ResolvedRule {
	key: string
	enabled: boolean
	autoadd: boolean
	no_overwrite: boolean
	trigger: Trigger[]
	whererun: string[]
	whereignore: string[]
	strip_markdown: boolean
	trim_whitespace: boolean
	case_sensitive: boolean
	format: string
	type: RuleType
	match: LineMatch
	value: string
	pull: Pull
	pull_next: boolean
	omit_match: boolean
	ignore_indentation: boolean
	start: string
	end: string
	inclusive: boolean
	multiline: boolean
	heading_match: HeadingMatch
	heading_value: string | number
	include_heading_line: boolean
	include_subheadings: boolean
	callout_type: string
	extract: CalloutExtract
	include_type_label: boolean
	file_pull: FilePull
}

// ── Defaults ──────────────────────────────────────────────────────────────────

export const RULE_DEFAULTS: Omit<ResolvedRule, 'key'> = {
	enabled:            true,
	autoadd:            false,
	no_overwrite:       false,
	trigger:            [],
	whererun:           [],
	whereignore:        [],
	strip_markdown:     false,
	trim_whitespace:    false,
	case_sensitive:     false,
	format:             '',
	type:               'lines',
	match:              'starting_with',
	value:              '',
	pull:               'first',
	pull_next:          false,
	omit_match:         true,
	ignore_indentation: false,
	start:              '',
	end:                '',
	inclusive:          false,
	multiline:          false,
	heading_match:      'level',
	heading_value:      1,
	include_heading_line: false,
	include_subheadings:  false,
	callout_type:       '',
	extract:            'body',
	include_type_label: false,
	file_pull:          'name',
}

const KNOWN_KEYS = new Set<string>(['key', ...Object.keys(RULE_DEFAULTS)])

export const DEFAULT_SETTINGS: AutoPropertyPluginSettings = {
	rules: [],
	showNotices: true,
}

// ── Pure functions ────────────────────────────────────────────────────────────

export function flattenRule(obj: unknown): Record<string, unknown> {
	if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {}
	const result: Record<string, unknown> = {}
	const record = obj as Record<string, unknown>
	for (const k of Object.keys(record)) {
		const v = record[k]
		if (v === undefined) continue
		if (KNOWN_KEYS.has(k)) {
			if (!(k in result)) result[k] = v
		} else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
			const nested = flattenRule(v)
			for (const nk of Object.keys(nested)) {
				if (!(nk in result)) result[nk] = nested[nk]
			}
		}
	}
	return result
}

export function applyDefaults(partial: Record<string, unknown>): ResolvedRule {
	const defaults = RULE_DEFAULTS as unknown as Record<string, unknown>
	const base: Record<string, unknown> = {}
	for (const k of Object.keys(defaults)) {
		const v = defaults[k]
		base[k] = Array.isArray(v) ? [...v] : v
	}
	const flat = flattenRule(partial)
	for (const k of Object.keys(flat)) {
		if (flat[k] !== undefined) base[k] = flat[k]
	}
	base['key'] = base['key'] !== undefined ? String(base['key']) : ''
	return base as unknown as ResolvedRule
}

export function stripDefaults(rule: ResolvedRule): AutoPropertyRule {
	const result: Record<string, unknown> = { key: rule.key }
	const defaults = RULE_DEFAULTS as unknown as Record<string, unknown>
	const ruleRecord = rule as unknown as Record<string, unknown>
	for (const k of Object.keys(defaults)) {
		const v = ruleRecord[k]
		const d = defaults[k]
		if (Array.isArray(v) && Array.isArray(d)) {
			if (v.length !== d.length || !v.every((item, i) => item === (d as unknown[])[i])) {
				result[k] = v
			}
		} else if (v !== d) {
			result[k] = v
		}
	}
	return result as unknown as AutoPropertyRule
}

// ── Type-specific field names (for type-switching cache in GUI) ───────────────

const TYPE_FIELDS: Record<RuleType, (keyof ResolvedRule)[]> = {
	lines:    ['pull', 'match', 'value', 'pull_next', 'omit_match', 'ignore_indentation'],
	between:  ['pull', 'start', 'end', 'inclusive', 'multiline'],
	headings: ['pull', 'heading_match', 'heading_value', 'include_heading_line', 'include_subheadings'],
	callouts: ['pull', 'callout_type', 'extract', 'include_type_label'],
	file:     ['file_pull'],
}

function extractTypeFields(wip: ResolvedRule): Partial<ResolvedRule> {
	const out: Record<string, unknown> = {}
	for (const f of TYPE_FIELDS[wip.type]) {
		out[f] = (wip as unknown as Record<string, unknown>)[f]
	}
	return out as Partial<ResolvedRule>
}

function applyTypeDefaults(type: RuleType): Partial<ResolvedRule> {
	const defaults = RULE_DEFAULTS as unknown as Record<string, unknown>
	const out: Record<string, unknown> = {}
	for (const k of TYPE_FIELDS[type]) {
		out[k] = defaults[k]
	}
	return out as Partial<ResolvedRule>
}

// ── Settings Tab ──────────────────────────────────────────────────────────────

export class AutoPropertiesSettingsTab extends PluginSettingTab {
	plugin: IAutoPropertyPlugin

	constructor(app: App, plugin: IAutoPropertyPlugin) {
		super(app, plugin as any)
		this.plugin = plugin
	}

	display(): void {
		const { containerEl } = this
		containerEl.empty()

		new Setting(containerEl)
			.setName('Show notices')
			.setDesc('Show a notice every time auto-property values have been updated.')
			.addToggle(toggle => {
				toggle.setValue(this.plugin.settings.showNotices).onChange(async value => {
					this.plugin.settings.showNotices = value
					await this.plugin.saveSettings()
				})
			})

		containerEl.createEl('h2', { text: 'Auto-properties', cls: 'ap-main-heading' })

		this.plugin.settings.rules.forEach((rule, index) => {
			containerEl.appendChild(this.createRulePanel(rule, index))
		})

		const addBtn = containerEl.createEl('button', { text: '+ Add auto-property', cls: 'ap-add-btn' })
		addBtn.onclick = async () => {
			this.plugin.settings.rules.push({ key: '' })
			await this.plugin.saveSettings()
			this.display()
		}

		// ── Import / Export ──────────────────────────────────────────────────

		new Setting(containerEl).setName('Import / Export').setHeading()

		new Setting(containerEl)
			.setName('Export rules')
			.setDesc('Copies all current rules as JSON to your clipboard, and shows the JSON below for manual copying if the clipboard is unavailable.')
			.addButton(btn => {
				btn.setButtonText('Export to clipboard')
				btn.onClick(() => {
					const json = JSON.stringify(this.plugin.settings.rules, null, 2)
					exportTextarea.value = json
					exportTextarea.style.display = 'block'
					navigator.clipboard.writeText(json).then(() => {
						new Notice('Rules copied to clipboard.')
					}).catch(() => {
						new Notice('Clipboard unavailable — copy the JSON below.')
					})
				})
			})

		const exportTextarea = document.createElement('textarea')
		exportTextarea.readOnly = true
		exportTextarea.style.display = 'none'
		exportTextarea.style.width = '100%'
		exportTextarea.style.minHeight = '160px'
		exportTextarea.style.fontFamily = 'monospace'
		exportTextarea.style.fontSize = 'var(--font-smallest)'
		exportTextarea.style.marginBottom = '16px'
		containerEl.appendChild(exportTextarea)

		new Setting(containerEl)
			.setName('Import rules')
			.setDesc('Paste exported JSON below. "Append" adds rules to the end of your existing list. "Replace all" discards current rules and loads the imported ones.')

		const importTextarea = document.createElement('textarea')
		importTextarea.style.width = '100%'
		importTextarea.style.minHeight = '160px'
		importTextarea.style.fontFamily = 'monospace'
		importTextarea.style.fontSize = 'var(--font-smallest)'
		importTextarea.style.marginBottom = '8px'
		importTextarea.placeholder = 'Paste exported JSON here…'
		containerEl.appendChild(importTextarea)

		const importButtons = document.createElement('div')
		importButtons.style.display = 'flex'
		importButtons.style.gap = '8px'
		containerEl.appendChild(importButtons)

		const appendBtn = document.createElement('button')
		appendBtn.setText('Append to existing')
		appendBtn.onclick = async () => {
			const rules = parseRulesJson(importTextarea.value)
			if (!rules) {
				new Notice('Invalid JSON — must be an array of rule objects, each with a "key" field.')
				return
			}
			this.plugin.settings.rules.push(...rules)
			await this.plugin.saveSettings()
			this.display()
			new Notice(`Appended ${rules.length} ${rules.length === 1 ? 'rule' : 'rules'}.`)
		}
		importButtons.appendChild(appendBtn)

		const replaceBtn = document.createElement('button')
		replaceBtn.setText('Replace all rules')
		replaceBtn.addClasses(['mod-warning'])
		replaceBtn.onclick = async () => {
			const rules = parseRulesJson(importTextarea.value)
			if (!rules) {
				new Notice('Invalid JSON — must be an array of rule objects, each with a "key" field.')
				return
			}
			this.plugin.settings.rules = rules
			await this.plugin.saveSettings()
			this.display()
			new Notice(`Replaced all rules with ${rules.length} imported ${rules.length === 1 ? 'rule' : 'rules'}.`)
		}
		importButtons.appendChild(replaceBtn)
	}

	createRulePanel(autoProp: AutoPropertyRule, index: number): HTMLElement {
		let wip: ResolvedRule = applyDefaults(autoProp as unknown as Record<string, unknown>)
		const typeCache: Partial<Record<RuleType, Partial<ResolvedRule>>> = {
			[wip.type]: extractTypeFields(wip),
		}

		const panel = document.createElement('div')
		panel.addClass('ap-panel')

		// ── Summary row ──────────────────────────────────────────────────────

		const summaryEl = panel.createDiv('ap-summary')

		const buildSummary = () => {
			summaryEl.empty()

			const left = summaryEl.createDiv('ap-summary-left')
			if (wip.key) {
				left.createSpan({ text: wip.key, cls: 'ap-summary-key' })
			} else {
				left.createSpan({ text: '✦ New auto-property', cls: 'ap-summary-key ap-key-missing' })
			}
			left.createSpan({ text: !wip.enabled ? '— disabled' : makeSummaryText(wip), cls: 'ap-summary-desc' })

			const badges = summaryEl.createDiv('ap-summary-badges')
			const triggerDefs: { value: Trigger; icon: string; title: string }[] = [
				{ value: 'modification', icon: 'pencil',           title: 'On modification' },
				{ value: 'open',         icon: 'file',             title: 'On open' },
				{ value: 'focus_change', icon: 'arrow-left-right', title: 'On focus change' },
			]
			for (const { value, icon, title } of triggerDefs) {
				const b = badges.createSpan({
					cls: 'ap-badge ' + (wip.trigger.includes(value) ? 'ap-badge-on' : 'ap-badge-off'),
					attr: { title },
				})
				setIcon(b, icon)
			}
			if (wip.autoadd || wip.no_overwrite) {
				badges.createDiv('ap-badge-sep')
			}
			if (wip.autoadd) {
				const b = badges.createSpan({ cls: 'ap-badge ap-badge-behavior', attr: { title: 'Auto-adds property if missing' } })
				setIcon(b, 'plus-square')
			}
			if (wip.no_overwrite) {
				const b = badges.createSpan({ cls: 'ap-badge ap-badge-behavior', attr: { title: 'Does not overwrite existing values' } })
				setIcon(b, 'lock')
			}
		}

		buildSummary()

		// ── Body ─────────────────────────────────────────────────────────────

		const body = panel.createDiv('ap-body')
		if (autoProp.key) body.addClass('hide')
		summaryEl.onclick = () => body.toggleClass('hide', !body.hasClass('hide'))

		let jsonMode = false

		// Top bar: key input + Save / Delete / JSON toggle
		const topBar   = body.createDiv('ap-top-bar')
		const keyInput = topBar.createEl('input', {
			type: 'text',
			cls: 'ap-key-input',
			attr: { placeholder: 'property-key' },
		})
		keyInput.value = wip.key

		const topActions = topBar.createDiv('ap-top-actions')
		const saveBtn    = topActions.createEl('button', { text: 'Save',     cls: 'ap-save-btn' })
		const deleteBtn  = topActions.createEl('button', { text: 'Delete',   cls: 'mod-warning' })
		const jsonBtn    = topActions.createEl('button', { text: '{ } JSON' })

		const markDirty = () => saveBtn.addClass('highlight')
		keyInput.oninput = () => { wip.key = keyInput.value; markDirty() }

		const jsonView   = body.createDiv()
		jsonView.addClass('hide')
		const jsonEditor = jsonView.createEl('textarea', { cls: 'ap-json-editor' })
		jsonEditor.onchange = markDirty

		const guiView = body.createDiv()

		saveBtn.onclick = async () => {
			if (jsonMode) {
				const parsed = tryParseRuleJson(jsonEditor.value)
				if (!parsed) { new Notice('Invalid JSON — please fix before saving.'); return }
				wip = applyDefaults(parsed as unknown as Record<string, unknown>)
			}
			if (!wip.key.trim()) { new Notice('Key cannot be blank.'); return }
			this.plugin.settings.rules[index] = stripDefaults(wip)
			await this.plugin.saveSettings()
			this.display()
			new Notice('Auto-property saved.')
		}

		deleteBtn.onclick = async () => {
			this.plugin.settings.rules.splice(index, 1)
			await this.plugin.saveSettings()
			this.display()
		}

		jsonBtn.onclick = () => {
			jsonMode = !jsonMode
			if (jsonMode) {
				jsonEditor.value = JSON.stringify(stripDefaults(wip), null, 2)
				guiView.addClass('hide')
				jsonView.removeClass('hide')
				jsonBtn.setText('⚙ GUI')
			} else {
				const parsed = tryParseRuleJson(jsonEditor.value)
				if (!parsed) { new Notice('Invalid JSON — fix before switching back.'); return }
				wip = applyDefaults(parsed as unknown as Record<string, unknown>)
				guiView.removeClass('hide')
				jsonView.addClass('hide')
				jsonBtn.setText('{ } JSON')
				rebuildGui()
			}
		}

		const rebuildGui = () => {
			guiView.empty()

			// ── Core row: type selector + behaviour toggles ───────────────────
			const coreRow = guiView.createDiv('ap-row')
			coreRow.createSpan({ text: 'Type', cls: 'ap-row-label' })
			const typeSelect = coreRow.createEl('select', { cls: 'ap-select' })
			;(['lines', 'between', 'headings', 'callouts', 'file'] as RuleType[]).forEach(t => {
				const opt = typeSelect.createEl('option', { value: t, text: t.charAt(0).toUpperCase() + t.slice(1) })
				if (wip.type === t) opt.selected = true
			})
			typeSelect.onchange = () => {
				const newType = typeSelect.value as RuleType
				typeCache[wip.type] = extractTypeFields(wip)
				const cached = typeCache[newType]
				wip = { ...wip, ...applyTypeDefaults(newType), ...cached, type: newType }
				markDirty()
				rebuildGui()
			}
			coreRow.createDiv('ap-spacer')
			addCheck(coreRow, 'Enabled',      wip.enabled,      v => { wip.enabled      = v; markDirty() })
			addCheck(coreRow, 'Auto-add',     wip.autoadd,      v => { wip.autoadd      = v; markDirty() })
			addCheck(coreRow, 'No overwrite', wip.no_overwrite, v => { wip.no_overwrite = v; markDirty() })

			// ── Type-specific fields ──────────────────────────────────────────
			guiView.createDiv({ cls: 'ap-section-header', text: 'Input' })
			const typeSection = guiView.createDiv('ap-type-section')
			buildCompactTypeFields(typeSection, wip, markDirty)

			// ── Output & Filters ──────────────────────────────────────────────
			guiView.createDiv({ cls: 'ap-section-header', text: 'Output & Filters' })
			const outputRow = guiView.createDiv('ap-row')
			addCheck(outputRow, 'Strip markdown',  wip.strip_markdown,  v => { wip.strip_markdown  = v; markDirty() })
			addCheck(outputRow, 'Trim whitespace', wip.trim_whitespace, v => { wip.trim_whitespace = v; markDirty() })

			const formatField = guiView.createDiv('ap-field')
			formatField.createEl('label', { text: 'Value format', cls: 'ap-field-label' })
			const formatInput = formatField.createEl('input', {
				type: 'text',
				cls: 'ap-field-input',
				attr: { placeholder: 'e.g. https://example.com/${result}' },
			})
			formatInput.value = wip.format
			formatInput.oninput = () => { wip.format = formatInput.value; markDirty() }

			// ── Triggers ─────────────────────────────────────────────────────
			guiView.createDiv({ cls: 'ap-section-header', text: 'Triggers' })
			const triggersRow = guiView.createDiv('ap-triggers-row')
			const triggerDefs: { value: Trigger; label: string; icon: string; desc: string }[] = [
				{ value: 'modification', label: 'Modify', icon: 'pencil',           desc: 'Runs shortly after the note content changes.' },
				{ value: 'open',         label: 'Open',   icon: 'file',             desc: 'Runs once when the note is opened.' },
				{ value: 'focus_change', label: 'Focus',  icon: 'arrow-left-right', desc: 'Runs when you switch away from this note.' },
			]
			for (const { value, label, icon, desc } of triggerDefs) {
				const pill = triggersRow.createEl('button', {
					cls: 'ap-trigger-pill' + (wip.trigger.includes(value) ? ' ap-on' : ''),
					attr: { title: desc },
				})
				setIcon(pill, icon)
				pill.appendText(' ' + label)
				pill.onclick = () => {
					if (wip.trigger.includes(value)) {
						wip.trigger = wip.trigger.filter(t => t !== value)
						pill.removeClass('ap-on')
					} else {
						wip.trigger.push(value)
						pill.addClass('ap-on')
					}
					markDirty()
				}
			}

			// ── Scope ─────────────────────────────────────────────────────────
			guiView.createDiv({ cls: 'ap-section-header', text: 'Scope' })
			const scopeRow  = guiView.createDiv('ap-scope-row')

			const runHalf = scopeRow.createDiv('ap-scope-half')
			runHalf.createEl('label', { text: 'Run in folders', cls: 'ap-field-label' })
			const runTa = runHalf.createEl('textarea', {
				cls: 'ap-scope-textarea',
				attr: { rows: '2', placeholder: '/projects\n/work' },
			})
			runTa.value = wip.whererun.join('\n')
			runTa.oninput = () => { wip.whererun = runTa.value.split('\n').map(s => s.trim()).filter(Boolean); markDirty() }

			const ignoreHalf = scopeRow.createDiv('ap-scope-half')
			ignoreHalf.createEl('label', { text: 'Ignore folders', cls: 'ap-field-label' })
			const ignoreTa = ignoreHalf.createEl('textarea', {
				cls: 'ap-scope-textarea',
				attr: { rows: '2', placeholder: '/templates\n/archive' },
			})
			ignoreTa.value = wip.whereignore.join('\n')
			ignoreTa.oninput = () => { wip.whereignore = ignoreTa.value.split('\n').map(s => s.trim()).filter(Boolean); markDirty() }
		}

		rebuildGui()
		return panel
	}
}

// ── Compact type field builders ───────────────────────────────────────────────

function addCheck(
	container: HTMLElement,
	label: string,
	value: boolean,
	onChange: (v: boolean) => void,
): void {
	const el = container.createEl('label', { cls: 'ap-check' })
	const cb = el.createEl('input', { type: 'checkbox' })
	cb.checked = value
	cb.onchange = () => onChange(cb.checked)
	el.createSpan({ text: label })
}

function addSelect<T extends string>(
	container: HTMLElement,
	options: [T, string][],
	value: T,
	onChange: (v: T) => void,
): HTMLSelectElement {
	const sel = container.createEl('select', { cls: 'ap-select' })
	for (const [v, label] of options) {
		const opt = sel.createEl('option', { value: v, text: label })
		if (value === v) opt.selected = true
	}
	sel.onchange = () => onChange(sel.value as T)
	return sel
}

function addInlineInput(
	container: HTMLElement,
	placeholder: string,
	value: string,
	onChange: (v: string) => void,
	grow = false,
): HTMLInputElement {
	const input = container.createEl('input', {
		type: 'text',
		cls: 'ap-inline-input' + (grow ? ' ap-grow' : ''),
		attr: { placeholder },
	})
	input.value = value
	input.oninput = () => onChange(input.value)
	return input
}

// Wraps a label+control pair so they stay together when the row wraps on narrow screens
function pair(row: HTMLElement, grow = false): HTMLElement {
	return row.createDiv('ap-field-pair' + (grow ? ' ap-pair-grow' : ''))
}

function buildCompactTypeFields(el: HTMLElement, wip: ResolvedRule, markDirty: () => void): void {
	switch (wip.type) {
		case 'file':     buildFileCompact(el, wip, markDirty);     break
		case 'lines':    buildLinesCompact(el, wip, markDirty);    break
		case 'between':  buildBetweenCompact(el, wip, markDirty);  break
		case 'headings': buildHeadingsCompact(el, wip, markDirty); break
		case 'callouts': buildCalloutsCompact(el, wip, markDirty); break
	}
}

function buildFileCompact(el: HTMLElement, wip: ResolvedRule, markDirty: () => void): void {
	const row = el.createDiv('ap-row')
	const p = pair(row)
	p.createSpan({ text: 'Pull', cls: 'ap-row-label' })
	addSelect<FilePull>(p, [
		['name',      'File name'],
		['path',      'Full path'],
		['folder',    'Folder'],
		['extension', 'Extension'],
		['created',   'Created date'],
		['modified',  'Modified date'],
		['size',      'File size (bytes)'],
	], wip.file_pull, v => { wip.file_pull = v; markDirty() })
}

function buildLinesCompact(el: HTMLElement, wip: ResolvedRule, markDirty: () => void): void {
	const row1 = el.createDiv('ap-row')

	const pullP = pair(row1)
	pullP.createSpan({ text: 'Pull', cls: 'ap-row-label' })
	addSelect<Pull>(pullP, [
		['first', 'First'],
		['all',   'All'],
		['count', 'Count'],
	], wip.pull, v => { wip.pull = v; markDirty() })

	const matchP = pair(row1)
	matchP.createSpan({ text: 'Match', cls: 'ap-row-label' })
	addSelect<LineMatch>(matchP, [
		['starting_with', 'Starting with'],
		['ending_with',   'Ending with'],
		['containing',    'Containing'],
		['regex',         'Regex'],
	], wip.match, v => { wip.match = v; markDirty() })

	const searchP = pair(row1, true)
	searchP.createSpan({ text: 'Search string', cls: 'ap-row-label' })
	addInlineInput(searchP, 'e.g. - [ ]', wip.value, v => { wip.value = v; markDirty() }, true)

	const row2 = el.createDiv('ap-row')
	addCheck(row2, 'Include search string', !wip.omit_match,         v => { wip.omit_match         = !v; markDirty() })
	addCheck(row2, 'Case sensitive',         wip.case_sensitive,     v => { wip.case_sensitive     = v;  markDirty() })
	addCheck(row2, 'Pull next line',         wip.pull_next,          v => { wip.pull_next          = v;  markDirty() })
	addCheck(row2, 'Ignore indentation',     wip.ignore_indentation, v => { wip.ignore_indentation = v;  markDirty() })
}

function buildBetweenCompact(el: HTMLElement, wip: ResolvedRule, markDirty: () => void): void {
	const row1 = el.createDiv('ap-row')

	const pullP = pair(row1)
	pullP.createSpan({ text: 'Pull', cls: 'ap-row-label' })
	addSelect<Pull>(pullP, [
		['first', 'First'],
		['all',   'All'],
		['count', 'Count'],
	], wip.pull, v => { wip.pull = v; markDirty() })

	const startP = pair(row1)
	startP.createSpan({ text: 'Start', cls: 'ap-row-label' })
	addInlineInput(startP, 'e.g. ==', wip.start, v => { wip.start = v; markDirty() }).addClass('ap-narrow')

	const endP = pair(row1)
	endP.createSpan({ text: 'End', cls: 'ap-row-label' })
	addInlineInput(endP, 'Same as start', wip.end, v => { wip.end = v; markDirty() }).addClass('ap-narrow')

	const row2 = el.createDiv('ap-row')
	addCheck(row2, 'Inclusive',      wip.inclusive,      v => { wip.inclusive      = v; markDirty() })
	addCheck(row2, 'Multiline',      wip.multiline,      v => { wip.multiline      = v; markDirty() })
	addCheck(row2, 'Case sensitive', wip.case_sensitive, v => { wip.case_sensitive = v; markDirty() })
}

function buildHeadingsCompact(el: HTMLElement, wip: ResolvedRule, markDirty: () => void): void {
	const row1 = el.createDiv('ap-row')

	const pullP = pair(row1)
	pullP.createSpan({ text: 'Pull', cls: 'ap-row-label' })
	addSelect<Pull>(pullP, [
		['text',  'Heading text only'],
		['first', 'Full section content'],
		['count', 'Count'],
	], wip.pull, v => { wip.pull = v; markDirty() })

	const targetP = pair(row1)
	targetP.createSpan({ text: 'Target by', cls: 'ap-row-label' })
	addSelect<HeadingMatch>(targetP, [
		['level', 'Level (1–6)'],
		['text',  'Heading text'],
	], wip.heading_match, v => { wip.heading_match = v; markDirty() })

	const valP = pair(row1)
	valP.createSpan({ text: 'Value', cls: 'ap-row-label' })
	addInlineInput(
		valP,
		wip.heading_match === 'level' ? '1–6' : 'Heading text',
		String(wip.heading_value),
		v => { wip.heading_value = wip.heading_match === 'level' ? parseInt(v) || 1 : v; markDirty() },
	).addClass('ap-narrow')

	const row2 = el.createDiv('ap-row')
	addCheck(row2, 'Include heading line', wip.include_heading_line, v => { wip.include_heading_line = v; markDirty() })
	addCheck(row2, 'Include subheadings',  wip.include_subheadings,  v => { wip.include_subheadings  = v; markDirty() })
}

function buildCalloutsCompact(el: HTMLElement, wip: ResolvedRule, markDirty: () => void): void {
	const row1 = el.createDiv('ap-row')

	const pullP = pair(row1)
	pullP.createSpan({ text: 'Pull', cls: 'ap-row-label' })
	addSelect<Pull>(pullP, [
		['first', 'First'],
		['all',   'All'],
		['count', 'Count'],
	], wip.pull, v => { wip.pull = v; markDirty() })

	const typeP = pair(row1)
	typeP.createSpan({ text: 'Type filter', cls: 'ap-row-label' })
	addInlineInput(typeP, 'Any type', wip.callout_type, v => { wip.callout_type = v; markDirty() }).addClass('ap-narrow')

	const extractP = pair(row1)
	extractP.createSpan({ text: 'Extract', cls: 'ap-row-label' })
	addSelect<CalloutExtract>(extractP, [
		['header', 'Header'],
		['body',   'Body'],
		['both',   'Both'],
	], wip.extract, v => { wip.extract = v; markDirty() })

	const row2 = el.createDiv('ap-row')
	addCheck(row2, 'Include type label', wip.include_type_label, v => { wip.include_type_label = v; markDirty() })
	addCheck(row2, 'Case sensitive',     wip.case_sensitive,     v => { wip.case_sensitive     = v; markDirty() })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseRulesJson(raw: string): AutoPropertyRule[] | null {
	try {
		const parsed = JSON.parse(raw.trim())
		if (!Array.isArray(parsed)) return null
		if (!parsed.every(r => typeof r === 'object' && r !== null && typeof r.key === 'string')) return null
		return parsed as AutoPropertyRule[]
	} catch {
		return null
	}
}

function tryParseRuleJson(raw: string): AutoPropertyRule | null {
	try {
		const parsed = JSON.parse(raw)
		if (typeof parsed !== 'object' || !parsed.key) return null
		return parsed as AutoPropertyRule
	} catch {
		return null
	}
}

function makeSummaryText(rule: ResolvedRule): string {
	if (!rule.enabled) return '— disabled'
	switch (rule.type) {
		case 'file':     return `File → ${rule.file_pull}`
		case 'lines':    return `Lines → ${rule.pull} ${rule.match} "${rule.value}"`
		case 'between':  return `Between → ${rule.pull} between "${rule.start}"`
		case 'headings': return `Headings → ${rule.pull} (${rule.heading_match}: ${rule.heading_value})`
		case 'callouts': return `Callouts → ${rule.pull}${rule.callout_type ? ` [!${rule.callout_type}]` : ''} (${rule.extract})`
	}
}
