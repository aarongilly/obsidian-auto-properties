import { App, Notice, PluginSettingTab, Setting, setIcon } from 'obsidian'
import { t, tf } from './i18n'

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
			.setName(t('ui_show_notices'))
			.setDesc(t('ui_show_notices_desc'))
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

		const addBtn = containerEl.createEl('button', { text: t('ui_add_rule'), cls: 'ap-add-btn' })
		addBtn.onclick = async () => {
			this.plugin.settings.rules.push({ key: '' })
			await this.plugin.saveSettings()
			this.display()
		}

		const wikiP = containerEl.createEl('p', { cls: 'ap-wiki-link' })
		wikiP.createEl('a', {
			text: t('ui_wiki_link'),
			href: 'https://github.com/aarongilly/obsidian-auto-properties/wiki',
			attr: { target: '_blank', rel: 'noopener' },
		})

		// ── Import / Export ──────────────────────────────────────────────────

		new Setting(containerEl).setName(t('ui_import_export')).setHeading()

		new Setting(containerEl)
			.setName(t('ui_export_rules'))
			.setDesc(t('ui_export_rules_desc'))
			.addButton(btn => {
				btn.setButtonText(t('ui_export_to_clipboard'))
				btn.onClick(() => {
					const json = JSON.stringify(this.plugin.settings.rules, null, 2)
					exportTextarea.value = json
					exportTextarea.style.display = 'block'
					navigator.clipboard.writeText(json).then(() => {
						new Notice(t('notice_copied'))
					}).catch(() => {
						new Notice(t('notice_clipboard_unavail'))
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
			.setName(t('ui_import_rules'))
			.setDesc(t('ui_import_rules_desc'))

		const importTextarea = document.createElement('textarea')
		importTextarea.style.width = '100%'
		importTextarea.style.minHeight = '160px'
		importTextarea.style.fontFamily = 'monospace'
		importTextarea.style.fontSize = 'var(--font-smallest)'
		importTextarea.style.marginBottom = '8px'
		importTextarea.placeholder = t('ui_import_placeholder')
		containerEl.appendChild(importTextarea)

		const importButtons = document.createElement('div')
		importButtons.style.display = 'flex'
		importButtons.style.gap = '8px'
		containerEl.appendChild(importButtons)

		const appendBtn = document.createElement('button')
		appendBtn.setText(t('ui_append'))
		appendBtn.onclick = async () => {
			const rules = parseRulesJson(importTextarea.value)
			if (!rules) {
				new Notice(t('notice_invalid_json_import'))
				return
			}
			this.plugin.settings.rules.push(...rules)
			await this.plugin.saveSettings()
			this.display()
			new Notice(rules.length === 1
				? t('notice_appended_one')
				: tf('notice_appended_many', { count: rules.length })
			)
		}
		importButtons.appendChild(appendBtn)

		const replaceBtn = document.createElement('button')
		replaceBtn.setText(t('ui_replace_all'))
		replaceBtn.addClasses(['mod-warning'])
		replaceBtn.onclick = async () => {
			const rules = parseRulesJson(importTextarea.value)
			if (!rules) {
				new Notice(t('notice_invalid_json_import'))
				return
			}
			this.plugin.settings.rules = rules
			await this.plugin.saveSettings()
			this.display()
			new Notice(rules.length === 1
				? t('notice_replaced_one')
				: tf('notice_replaced_many', { count: rules.length })
			)
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
				left.createSpan({ text: t('ui_new_rule'), cls: 'ap-summary-key ap-key-missing' })
			}
			left.createSpan({ text: !wip.enabled ? t('ui_disabled') : makeSummaryText(wip), cls: 'ap-summary-desc' })

			const badges = summaryEl.createDiv('ap-summary-badges')
			const triggerDefs: { value: Trigger; icon: string; titleKey: 'badge_on_modify' | 'badge_on_open' | 'badge_on_focus' }[] = [
				{ value: 'modification', icon: 'pencil',           titleKey: 'badge_on_modify' },
				{ value: 'open',         icon: 'file',             titleKey: 'badge_on_open' },
				{ value: 'focus_change', icon: 'arrow-left-right', titleKey: 'badge_on_focus' },
			]
			for (const { value, icon, titleKey } of triggerDefs) {
				const b = badges.createSpan({
					cls: 'ap-badge ' + (wip.trigger.includes(value) ? 'ap-badge-on' : 'ap-badge-off'),
					attr: { title: t(titleKey) },
				})
				setIcon(b, icon)
			}
			if (wip.autoadd || wip.no_overwrite) {
				badges.createDiv('ap-badge-sep')
			}
			if (wip.autoadd) {
				const b = badges.createSpan({ cls: 'ap-badge ap-badge-behavior', attr: { title: t('badge_autoadd') } })
				setIcon(b, 'plus-square')
			}
			if (wip.no_overwrite) {
				const b = badges.createSpan({ cls: 'ap-badge ap-badge-behavior', attr: { title: t('badge_no_overwrite') } })
				setIcon(b, 'lock')
			}
		}

		buildSummary()

		// ── Body ─────────────────────────────────────────────────────────────

		const body = panel.createDiv('ap-body')
		if (autoProp.key) body.addClass('hide')
		summaryEl.onclick = () => body.toggleClass('hide', !body.hasClass('hide'))

		let jsonMode = false

		const topBar   = body.createDiv('ap-top-bar')
		const keyInput = topBar.createEl('input', {
			type: 'text',
			cls: 'ap-key-input',
			attr: { placeholder: t('ui_key_placeholder') },
		})
		keyInput.value = wip.key

		const topActions = topBar.createDiv('ap-top-actions')
		const saveBtn    = topActions.createEl('button', { text: t('ui_save'),   cls: 'ap-save-btn' })
		const deleteBtn  = topActions.createEl('button', { text: t('ui_delete'), cls: 'mod-warning' })
		const jsonBtn    = topActions.createEl('button', { text: t('ui_json_mode') })

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
				if (!parsed) { new Notice(t('notice_invalid_json_save')); return }
				wip = applyDefaults(parsed as unknown as Record<string, unknown>)
			}
			if (!wip.key.trim()) { new Notice(t('notice_key_blank')); return }
			this.plugin.settings.rules[index] = stripDefaults(wip)
			await this.plugin.saveSettings()
			this.display()
			new Notice(t('notice_saved'))
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
				jsonBtn.setText(t('ui_gui_mode'))
			} else {
				const parsed = tryParseRuleJson(jsonEditor.value)
				if (!parsed) { new Notice(t('notice_invalid_json_switch')); return }
				wip = applyDefaults(parsed as unknown as Record<string, unknown>)
				guiView.removeClass('hide')
				jsonView.addClass('hide')
				jsonBtn.setText(t('ui_json_mode'))
				rebuildGui()
			}
		}

		const rebuildGui = () => {
			guiView.empty()

			// ── Core row: type selector + behaviour toggles ───────────────────
			const coreRow = guiView.createDiv('ap-row')
			coreRow.createSpan({ text: t('ui_type'), cls: 'ap-row-label' })
			const typeSelect = coreRow.createEl('select', { cls: 'ap-select' })
			;(['lines', 'between', 'headings', 'callouts', 'file'] as RuleType[]).forEach(ruleType => {
				const labelKey = `type_${ruleType}` as const
				const opt = typeSelect.createEl('option', { value: ruleType, text: t(labelKey) })
				if (wip.type === ruleType) opt.selected = true
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
			addCheck(coreRow, t('check_enabled'),      wip.enabled,      v => { wip.enabled      = v; markDirty() })
			addCheck(coreRow, t('check_auto_add'),     wip.autoadd,      v => { wip.autoadd      = v; markDirty() })
			addCheck(coreRow, t('check_no_overwrite'), wip.no_overwrite, v => { wip.no_overwrite = v; markDirty() })

			// ── Type-specific fields ──────────────────────────────────────────
			guiView.createDiv({ cls: 'ap-section-header', text: t('section_input') })
			const typeSection = guiView.createDiv('ap-type-section')
			buildCompactTypeFields(typeSection, wip, markDirty)

			// ── Output & Filters ──────────────────────────────────────────────
			guiView.createDiv({ cls: 'ap-section-header', text: t('section_output') })
			const outputRow = guiView.createDiv('ap-row')
			addCheck(outputRow, t('check_strip_markdown'),  wip.strip_markdown,  v => { wip.strip_markdown  = v; markDirty() })
			addCheck(outputRow, t('check_trim_whitespace'), wip.trim_whitespace, v => { wip.trim_whitespace = v; markDirty() })

			const formatField = guiView.createDiv('ap-field')
			formatField.createEl('label', { text: t('ui_format_label'), cls: 'ap-field-label' })
			const formatInput = formatField.createEl('input', {
				type: 'text',
				cls: 'ap-field-input',
				attr: { placeholder: t('ui_format_placeholder') },
			})
			formatInput.value = wip.format
			formatInput.oninput = () => { wip.format = formatInput.value; markDirty() }

			// ── Triggers ─────────────────────────────────────────────────────
			guiView.createDiv({ cls: 'ap-section-header', text: t('section_triggers') })
			const triggersRow = guiView.createDiv('ap-triggers-row')
			const triggerDefs: { value: Trigger; labelKey: 'trigger_modify' | 'trigger_open' | 'trigger_focus'; icon: string; descKey: 'trigger_modify_desc' | 'trigger_open_desc' | 'trigger_focus_desc' }[] = [
				{ value: 'modification', labelKey: 'trigger_modify', icon: 'pencil',           descKey: 'trigger_modify_desc' },
				{ value: 'open',         labelKey: 'trigger_open',   icon: 'file',             descKey: 'trigger_open_desc' },
				{ value: 'focus_change', labelKey: 'trigger_focus',  icon: 'arrow-left-right', descKey: 'trigger_focus_desc' },
			]
			for (const { value, labelKey, icon, descKey } of triggerDefs) {
				const pill = triggersRow.createEl('button', {
					cls: 'ap-trigger-pill' + (wip.trigger.includes(value) ? ' ap-on' : ''),
					attr: { title: t(descKey) },
				})
				setIcon(pill, icon)
				pill.appendText(' ' + t(labelKey))
				pill.onclick = () => {
					if (wip.trigger.includes(value)) {
						wip.trigger = wip.trigger.filter(tr => tr !== value)
						pill.removeClass('ap-on')
					} else {
						wip.trigger.push(value)
						pill.addClass('ap-on')
					}
					markDirty()
				}
			}

			// ── Scope ─────────────────────────────────────────────────────────
			guiView.createDiv({ cls: 'ap-section-header', text: t('section_scope') })
			const scopeRow = guiView.createDiv('ap-scope-row')

			const runHalf = scopeRow.createDiv('ap-scope-half')
			runHalf.createEl('label', { text: t('scope_run_in'), cls: 'ap-field-label' })
			const runTa = runHalf.createEl('textarea', {
				cls: 'ap-scope-textarea',
				attr: { rows: '2', placeholder: t('scope_run_placeholder') },
			})
			runTa.value = wip.whererun.join('\n')
			runTa.oninput = () => { wip.whererun = runTa.value.split('\n').map(s => s.trim()).filter(Boolean); markDirty() }

			const ignoreHalf = scopeRow.createDiv('ap-scope-half')
			ignoreHalf.createEl('label', { text: t('scope_ignore'), cls: 'ap-field-label' })
			const ignoreTa = ignoreHalf.createEl('textarea', {
				cls: 'ap-scope-textarea',
				attr: { rows: '2', placeholder: t('scope_ignore_placeholder') },
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
	p.createSpan({ text: t('ui_pull'), cls: 'ap-row-label' })
	addSelect<FilePull>(p, [
		['name',      t('file_pull_name')],
		['path',      t('file_pull_path')],
		['folder',    t('file_pull_folder')],
		['extension', t('file_pull_extension')],
		['created',   t('file_pull_created')],
		['modified',  t('file_pull_modified')],
		['size',      t('file_pull_size')],
	], wip.file_pull, v => { wip.file_pull = v; markDirty() })
}

function buildLinesCompact(el: HTMLElement, wip: ResolvedRule, markDirty: () => void): void {
	const row1 = el.createDiv('ap-row')

	const pullP = pair(row1)
	pullP.createSpan({ text: t('ui_pull'), cls: 'ap-row-label' })
	addSelect<Pull>(pullP, [
		['first', t('pull_first')],
		['all',   t('pull_all')],
		['count', t('pull_count')],
	], wip.pull, v => { wip.pull = v; markDirty() })

	const matchP = pair(row1)
	matchP.createSpan({ text: t('ui_match'), cls: 'ap-row-label' })
	addSelect<LineMatch>(matchP, [
		['starting_with', t('match_starting_with')],
		['ending_with',   t('match_ending_with')],
		['containing',    t('match_containing')],
		['regex',         t('match_regex')],
	], wip.match, v => { wip.match = v; markDirty() })

	const searchP = pair(row1, true)
	searchP.createSpan({ text: t('ui_search'), cls: 'ap-row-label' })
	addInlineInput(searchP, t('search_placeholder'), wip.value, v => { wip.value = v; markDirty() }, true)

	const row2 = el.createDiv('ap-row')
	addCheck(row2, t('check_include_search'), !wip.omit_match,         v => { wip.omit_match         = !v; markDirty() })
	addCheck(row2, t('check_case_sensitive'),  wip.case_sensitive,     v => { wip.case_sensitive     = v;  markDirty() })
	addCheck(row2, t('check_pull_next'),       wip.pull_next,          v => { wip.pull_next          = v;  markDirty() })
	addCheck(row2, t('check_ignore_indent'),   wip.ignore_indentation, v => { wip.ignore_indentation = v;  markDirty() })
}

function buildBetweenCompact(el: HTMLElement, wip: ResolvedRule, markDirty: () => void): void {
	const row1 = el.createDiv('ap-row')

	const pullP = pair(row1)
	pullP.createSpan({ text: t('ui_pull'), cls: 'ap-row-label' })
	addSelect<Pull>(pullP, [
		['first', t('pull_first')],
		['all',   t('pull_all')],
		['count', t('pull_count')],
	], wip.pull, v => { wip.pull = v; markDirty() })

	const startP = pair(row1)
	startP.createSpan({ text: t('ui_start'), cls: 'ap-row-label' })
	addInlineInput(startP, t('start_placeholder'), wip.start, v => { wip.start = v; markDirty() }).addClass('ap-narrow')

	const endP = pair(row1)
	endP.createSpan({ text: t('ui_end'), cls: 'ap-row-label' })
	addInlineInput(endP, t('end_placeholder'), wip.end, v => { wip.end = v; markDirty() }).addClass('ap-narrow')

	const row2 = el.createDiv('ap-row')
	addCheck(row2, t('check_inclusive'),      wip.inclusive,      v => { wip.inclusive      = v; markDirty() })
	addCheck(row2, t('check_multiline'),      wip.multiline,      v => { wip.multiline      = v; markDirty() })
	addCheck(row2, t('check_case_sensitive'), wip.case_sensitive, v => { wip.case_sensitive = v; markDirty() })
}

function buildHeadingsCompact(el: HTMLElement, wip: ResolvedRule, markDirty: () => void): void {
	const row1 = el.createDiv('ap-row')

	const pullP = pair(row1)
	pullP.createSpan({ text: t('ui_pull'), cls: 'ap-row-label' })
	addSelect<Pull>(pullP, [
		['text',  t('pull_heading_text')],
		['first', t('pull_full_section')],
		['count', t('pull_count')],
	], wip.pull, v => { wip.pull = v; markDirty() })

	const targetP = pair(row1)
	targetP.createSpan({ text: t('ui_target_by'), cls: 'ap-row-label' })
	addSelect<HeadingMatch>(targetP, [
		['level', t('heading_target_level')],
		['text',  t('heading_target_text')],
	], wip.heading_match, v => { wip.heading_match = v; markDirty() })

	const valP = pair(row1)
	valP.createSpan({ text: t('ui_value'), cls: 'ap-row-label' })
	addInlineInput(
		valP,
		wip.heading_match === 'level' ? t('heading_value_placeholder_level') : t('heading_value_placeholder_text'),
		String(wip.heading_value),
		v => { wip.heading_value = wip.heading_match === 'level' ? parseInt(v) || 1 : v; markDirty() },
	).addClass('ap-narrow')

	const row2 = el.createDiv('ap-row')
	addCheck(row2, t('check_include_heading_line'), wip.include_heading_line, v => { wip.include_heading_line = v; markDirty() })
	addCheck(row2, t('check_include_subheadings'),  wip.include_subheadings,  v => { wip.include_subheadings  = v; markDirty() })
}

function buildCalloutsCompact(el: HTMLElement, wip: ResolvedRule, markDirty: () => void): void {
	const row1 = el.createDiv('ap-row')

	const pullP = pair(row1)
	pullP.createSpan({ text: t('ui_pull'), cls: 'ap-row-label' })
	addSelect<Pull>(pullP, [
		['first', t('pull_first')],
		['all',   t('pull_all')],
		['count', t('pull_count')],
	], wip.pull, v => { wip.pull = v; markDirty() })

	const typeP = pair(row1)
	typeP.createSpan({ text: t('ui_type_filter'), cls: 'ap-row-label' })
	addInlineInput(typeP, t('callout_filter_placeholder'), wip.callout_type, v => { wip.callout_type = v; markDirty() }).addClass('ap-narrow')

	const extractP = pair(row1)
	extractP.createSpan({ text: t('ui_extract'), cls: 'ap-row-label' })
	addSelect<CalloutExtract>(extractP, [
		['header', t('callout_extract_header')],
		['body',   t('callout_extract_body')],
		['both',   t('callout_extract_both')],
	], wip.extract, v => { wip.extract = v; markDirty() })

	const row2 = el.createDiv('ap-row')
	addCheck(row2, t('check_include_type_label'), wip.include_type_label, v => { wip.include_type_label = v; markDirty() })
	addCheck(row2, t('check_case_sensitive'),      wip.case_sensitive,     v => { wip.case_sensitive     = v; markDirty() })
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
	if (!rule.enabled) return t('ui_disabled')
	switch (rule.type) {
		case 'file': {
			const label: Record<string, string> = {
				name: 'file name', path: 'full path', folder: 'folder name',
				extension: 'file extension', created: 'creation date',
				modified: 'modification date', size: 'file size',
			}
			return `pulls ${label[rule.file_pull] ?? rule.file_pull}`
		}
		case 'lines': {
			const matchWord = ({ starting_with: 'starting with', ending_with: 'ending with', containing: 'containing', regex: 'matching' } as Record<string, string>)[rule.match] ?? rule.match
			if (rule.pull === 'count') return `counts lines ${matchWord} "${rule.value}"`
			if (rule.pull === 'all')   return `pulls all lines ${matchWord} "${rule.value}"`
			return `pulls first line ${matchWord} "${rule.value}"`
		}
		case 'between': {
			const end = rule.end || rule.start
			if (rule.pull === 'count') return `counts text between "${rule.start}" and "${end}"`
			if (rule.pull === 'all')   return `pulls all text between "${rule.start}" and "${end}"`
			return `pulls first text between "${rule.start}" and "${end}"`
		}
		case 'headings': {
			if (rule.pull === 'text') {
				return rule.heading_match === 'level'
					? `pulls heading text at level ${rule.heading_value}`
					: `pulls heading with text "${rule.heading_value}"`
			}
			return rule.heading_match === 'level'
				? `pulls section under level ${rule.heading_value} heading`
				: `pulls section under "${rule.heading_value}" heading`
		}
		case 'callouts': {
			const singular = rule.extract === 'header' ? 'header' : rule.extract === 'both' ? 'header and body' : 'body'
			const plural   = rule.extract === 'header' ? 'headers' : rule.extract === 'both' ? 'headers and bodies' : 'bodies'
			const typeFilter = rule.callout_type ? ` with type "${rule.callout_type}"` : ''
			if (rule.pull === 'count') return `counts callouts${typeFilter}`
			if (rule.pull === 'all')   return `pulls all callout ${plural}${typeFilter}`
			return `pulls first callout ${singular}${typeFilter}`
		}
	}
}
