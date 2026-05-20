import { App, Notice, PluginSettingTab, Setting } from 'obsidian'

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

		const propertiesHeading = document.createElement('h2')
		propertiesHeading.innerText = 'Auto-properties'
		propertiesHeading.addClass('my-head')
		containerEl.appendChild(propertiesHeading)

		this.plugin.settings.rules.forEach((rule, index) => {
			containerEl.appendChild(this.createAutoPropertyPanel(rule, index))
		})

		const addButton = document.createElement('button')
		addButton.setText('Add auto-property')
		addButton.addClass('my-button')
		addButton.onclick = async () => {
			this.plugin.settings.rules.push({ key: '' })
			await this.plugin.saveSettings()
			this.display()
		}
		containerEl.appendChild(addButton)

		// ── Import / Export ──────────────────────────────────────────────────

		new Setting(containerEl).setName('Import / Export').setHeading()

		// Export
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

		// Import
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

	createAutoPropertyPanel(autoProp: AutoPropertyRule, index: number): HTMLElement {
		let wip: ResolvedRule = applyDefaults(autoProp as unknown as Record<string, unknown>)

		const typeCache: Partial<Record<RuleType, Partial<ResolvedRule>>> = {
			[wip.type]: extractTypeFields(wip),
		}

		// ── Panel shell ──────────────────────────────────────────────────────

		const panel = document.createElement('div')
		panel.addClass('property-panel')

		const header = document.createElement('h3')
		header.addClasses(['key-header', 'clickable', 'mb-0'])
		header.innerText = autoProp.key ? autoProp.key : '✦ New auto-property'
		panel.appendChild(header)

		const summary = document.createElement('span')
		summary.innerText = autoProp.key ? makeSummaryText(wip) : '— click to configure'
		summary.addClasses(['italic', 'clickable'])
		panel.appendChild(summary)

		const container = document.createElement('div')
		panel.appendChild(container)
		if (autoProp.key) container.addClass('hide')

		let jsonMode = false
		const modeToggleRow = document.createElement('div')
		modeToggleRow.style.display = 'flex'
		modeToggleRow.style.alignItems = 'center'
		modeToggleRow.style.gap = '8px'
		modeToggleRow.style.marginBottom = '12px'
		modeToggleRow.style.marginTop = '8px'
		const modeToggleLabel = document.createElement('span')
		modeToggleLabel.style.fontSize = 'var(--font-smallest)'
		modeToggleLabel.style.color = 'var(--text-muted)'
		modeToggleLabel.innerText = 'Edit as:'
		const modeToggle = document.createElement('button')
		modeToggle.setText('{ } JSON')
		modeToggleRow.appendChild(modeToggleLabel)
		modeToggleRow.appendChild(modeToggle)
		container.appendChild(modeToggleRow)

		function toggleContainer() {
			container.toggleClass('hide', !container.hasClass('hide'))
			summary.toggleClass('hide', !summary.hasClass('hide'))
		}
		header.onclick = toggleContainer
		summary.onclick = toggleContainer

		const guiView  = document.createElement('div')
		const jsonView = document.createElement('div')
		container.appendChild(guiView)
		container.appendChild(jsonView)
		jsonView.addClass('hide')

		const buttonContainer = document.createElement('div')
		buttonContainer.addClass('button-container')

		const saveButton = document.createElement('button')
		saveButton.setText('Save')
		saveButton.onclick = async () => {
			if (jsonMode) {
				const parsed = tryParseRuleJson(jsonEditor.value)
				if (!parsed) {
					new Notice('Invalid JSON — please fix before saving.')
					return
				}
				wip = applyDefaults(parsed as unknown as Record<string, unknown>)
			}
			if (!wip.key.trim()) {
				new Notice('Key cannot be blank.')
				return
			}
			this.plugin.settings.rules[index] = stripDefaults(wip)
			await this.plugin.saveSettings()
			this.display()
			new Notice('Auto-property saved.')
		}
		buttonContainer.appendChild(saveButton)

		const deleteButton = document.createElement('button')
		deleteButton.setText('Delete')
		deleteButton.addClasses(['mod-warning'])
		deleteButton.onclick = async () => {
			this.plugin.settings.rules.splice(index, 1)
			await this.plugin.saveSettings()
			this.display()
		}
		buttonContainer.appendChild(deleteButton)

		function markDirty() { saveButton.addClass('highlight') }

		const jsonEditor = document.createElement('textarea')
		jsonEditor.style.width = '100%'
		jsonEditor.style.minHeight = '260px'
		jsonEditor.style.fontFamily = 'monospace'
		jsonEditor.style.fontSize = 'var(--font-smallest)'
		jsonEditor.style.marginTop = '8px'
		jsonEditor.onchange = markDirty
		jsonView.appendChild(jsonEditor)

		modeToggle.onclick = () => {
			jsonMode = !jsonMode
			if (jsonMode) {
				jsonEditor.value = JSON.stringify(stripDefaults(wip), null, 2)
				guiView.addClass('hide')
				jsonView.removeClass('hide')
				modeToggle.setText('⚙ GUI')
			} else {
				const parsed = tryParseRuleJson(jsonEditor.value)
				if (!parsed) {
					new Notice('Invalid JSON — fix it before switching back.')
					return
				}
				wip = applyDefaults(parsed as unknown as Record<string, unknown>)
				guiView.removeClass('hide')
				jsonView.addClass('hide')
				modeToggle.setText('{ } JSON')
				rebuildGuiView()
			}
		}

		const rebuildGuiView = () => {
			guiView.empty()

			new Setting(guiView)
				.setName('Property key')
				.setDesc('The frontmatter key this rule will create or update. Must match the key name exactly as it appears (or should appear) in your note\'s properties.')
				.setClass('setting-key')
				.addText(text =>
					text.setValue(wip.key).setPlaceholder('e.g. first-task').onChange(value => {
						wip.key = value
						markDirty()
					})
				)

			new Setting(guiView)
				.setName('Enabled')
				.setDesc('When disabled, this rule is ignored entirely and will not run on any trigger.')
				.addToggle(t => t.setValue(wip.enabled).onChange(v => { wip.enabled = v; markDirty() }))

			new Setting(guiView)
				.setName('Rule type')
				.setDesc('The source this rule pulls from. Lines matches text in your note body. Between extracts text between two delimiters. Headings targets heading sections. Callouts targets callout blocks. File pulls note metadata.')
				.addDropdown(drop => {
					drop.addOption('lines',    'Lines')
					drop.addOption('between',  'Between')
					drop.addOption('headings', 'Headings')
					drop.addOption('callouts', 'Callouts')
					drop.addOption('file',     'File')
					drop.setValue(wip.type)
					drop.onChange(value => {
						const newType = value as RuleType
						typeCache[wip.type] = extractTypeFields(wip)
						const cached = typeCache[newType]
						wip = { ...wip, ...applyTypeDefaults(newType), ...cached, type: newType }
						markDirty()
						rebuildGuiView()
					})
				})

			const ruleSection = document.createElement('div')
			ruleSection.addClass('rules-container')
			guiView.appendChild(ruleSection)
			buildTypeFields(ruleSection, wip, markDirty)

			new Setting(guiView).setName('Output').setHeading()

			new Setting(guiView)
				.setName('Strip markdown')
				.setDesc('Remove markdown syntax from the extracted value before saving. For example, "**bold text**" becomes "bold text", and "[[My Note]]" becomes "My Note".')
				.addToggle(t => t.setValue(wip.strip_markdown).onChange(v => { wip.strip_markdown = v; markDirty() }))

			new Setting(guiView)
				.setName('Trim whitespace')
				.setDesc('Remove leading and trailing spaces and newlines from the extracted value. Recommended for most rules.')
				.addToggle(t => t.setValue(wip.trim_whitespace).onChange(v => { wip.trim_whitespace = v; markDirty() }))

			new Setting(guiView)
				.setName('Value format')
				.setDesc(
					'Optional template to wrap or transform the extracted value. Use ${result} as a placeholder for the extracted value. ' +
					'Other available placeholders: ${filename}, ${folder}, ${path}, ${created}, ${modified}. ' +
					'Example: setting this to "https://example.com/${result}" would turn a result of "my-page" into "https://example.com/my-page".'
				)
				.addTextArea(t => {
					t.setValue(wip.format)
					t.setPlaceholder('e.g. https://example.com/${result}')
					t.onChange(v => { wip.format = v; markDirty() })
					t.inputEl.style.width = '100%'
					t.inputEl.rows = 3
				})

			new Setting(guiView).setName('Behaviour').setHeading()

			new Setting(guiView)
				.setName('Auto-add property')
				.setDesc('If the property key does not already exist in the note\'s frontmatter, automatically add it when the rule runs. If disabled, the rule will only update keys that are already present.')
				.addToggle(t => t.setValue(wip.autoadd).onChange(v => { wip.autoadd = v; markDirty() }))

			new Setting(guiView)
				.setName('No overwrite')
				.setDesc('If the property already has a non-empty value, skip this rule and leave the existing value untouched. Useful for "set once" properties like creation context or initial status.')
				.addToggle(t => t.setValue(wip.no_overwrite).onChange(v => { wip.no_overwrite = v; markDirty() }))

			new Setting(guiView)
				.setName('Case sensitive')
				.setDesc('When enabled, matching is case-sensitive — "TODO" will not match "todo". When disabled, case is ignored and both would match.')
				.addToggle(t => t.setValue(wip.case_sensitive).onChange(v => { wip.case_sensitive = v; markDirty() }))

			new Setting(guiView).setName('Triggers').setHeading()

			const triggersDesc = guiView.createEl('p', {
				text: 'Choose when this rule runs automatically. If no triggers are enabled, the rule will only run when invoked manually via the "Update auto-properties" command.',
			})
			triggersDesc.style.fontSize = 'var(--font-small)'
			triggersDesc.style.color = 'var(--text-muted)'
			triggersDesc.style.marginTop = '0'
			triggersDesc.style.marginBottom = '8px'

			const triggers: { value: Trigger; label: string; desc: string }[] = [
				{ value: 'modification', label: 'On modification', desc: 'Runs shortly after the note content changes. Good for keeping properties in sync as you write.' },
				{ value: 'open',         label: 'On open',         desc: 'Runs once when the note is opened. Useful for rules that are slow or expensive to compute.' },
				{ value: 'focus_change', label: 'On focus change', desc: 'Runs on the previously active note when you switch to a different tab. Mirrors the behaviour of the Linter plugin.' },
			]

			triggers.forEach(({ value, label, desc }) => {
				new Setting(guiView)
					.setName(label)
					.setDesc(desc)
					.addToggle(t =>
						t.setValue(wip.trigger.includes(value)).onChange(checked => {
							if (checked) {
								if (!wip.trigger.includes(value)) wip.trigger.push(value)
							} else {
								wip.trigger = wip.trigger.filter(tr => tr !== value)
							}
							markDirty()
						})
					)
			})

			new Setting(guiView).setName('Scope').setHeading()

			new Setting(guiView)
				.setName('Run in folders')
				.setDesc('Only run in these folders (and subfolders). Leave blank for entire vault.')
				.addTextArea(t =>
					t.setValue(wip.whererun.join('\n')).setPlaceholder('e.g. projects').onChange(v => {
						wip.whererun = v.split('\n').map(s => s.trim()).filter(Boolean)
						markDirty()
					})
				)

			new Setting(guiView)
				.setName('Ignore folders')
				.setDesc('Never run in these folders (and subfolders).')
				.addTextArea(t =>
					t.setValue(wip.whereignore.join('\n')).setPlaceholder('e.g. assets/templates').onChange(v => {
						wip.whereignore = v.split('\n').map(s => s.trim()).filter(Boolean)
						markDirty()
					})
				)

			guiView.appendChild(buttonContainer)
		}

		rebuildGuiView()
		return panel
	}
}

// ── Type-specific field builders ──────────────────────────────────────────────

function buildTypeFields(container: HTMLElement, wip: ResolvedRule, markDirty: () => void): void {
	switch (wip.type) {
		case 'file':     buildFileFields(container, wip, markDirty);     break
		case 'lines':    buildLinesFields(container, wip, markDirty);    break
		case 'between':  buildBetweenFields(container, wip, markDirty);  break
		case 'headings': buildHeadingsFields(container, wip, markDirty); break
		case 'callouts': buildCalloutsFields(container, wip, markDirty); break
	}
}

function buildFileFields(el: HTMLElement, wip: ResolvedRule, markDirty: () => void): void {
	new Setting(el)
		.setName('Pull')
		.setDesc('Which piece of file metadata to use as the property value.')
		.addDropdown(d => {
			const options: Record<FilePull, string> = {
				name:      'File name',
				path:      'Full path',
				folder:    'Folder',
				extension: 'Extension',
				created:   'Created date',
				modified:  'Modified date',
				size:      'File size (bytes)',
			}
			Object.keys(options).forEach(v => d.addOption(v, (options as Record<string, string>)[v]))
			d.setValue(wip.file_pull).onChange(v => { wip.file_pull = v as FilePull; markDirty() })
		})
}

function buildLinesFields(el: HTMLElement, wip: ResolvedRule, markDirty: () => void): void {
	new Setting(el)
		.setName('Pull')
		.setDesc('"First" returns only the first matched line. "All" returns every matched line as a list. "Count" returns the number of matched lines as a number.')
		.addDropdown(d => {
			d.addOption('first', 'First matching line')
			d.addOption('all',   'All matching lines')
			d.addOption('count', 'Count of matching lines')
			d.setValue(wip.pull).onChange(v => { wip.pull = v as Pull; markDirty() })
		})

	new Setting(el)
		.setName('Match')
		.setDesc('How to compare each line against the search string below. "Containing" is the most flexible — it matches any line that includes the string anywhere within it.')
		.addDropdown(d => {
			d.addOption('starting_with', 'Starting with')
			d.addOption('ending_with',   'Ending with')
			d.addOption('containing',    'Containing')
			d.addOption('regex',         'Matching regex')
			d.setValue(wip.match).onChange(v => { wip.match = v as LineMatch; markDirty() })
		})
		.addText(t =>
			t.setValue(wip.value).setPlaceholder('Search string').onChange(v => {
				wip.value = v
				markDirty()
			})
		)

	new Setting(el)
		.setName('Include search string')
		.setDesc('When enabled, the search string itself is included in the extracted value. When disabled (default), the search string is stripped from the result — useful when matching syntax like "- [ ]" to return only the task text.')
		.addToggle(t => t.setValue(!wip.omit_match).onChange(v => { wip.omit_match = !v; markDirty() }))

	new Setting(el)
		.setName('Pull next line')
		.setDesc('Instead of returning the matched line itself, return the line immediately after it. Useful when your note uses label lines like "Status:" followed by the actual value on the next line.')
		.addToggle(t => t.setValue(wip.pull_next).onChange(v => { wip.pull_next = v; markDirty() }))
}

function buildBetweenFields(el: HTMLElement, wip: ResolvedRule, markDirty: () => void): void {
	new Setting(el)
		.setName('Pull')
		.setDesc('"First" returns the first match only. "All" returns every match as a list. "Count" returns the total number of matches as a number.')
		.addDropdown(d => {
			d.addOption('first', 'First match')
			d.addOption('all',   'All matches')
			d.addOption('count', 'Count of matches')
			d.setValue(wip.pull).onChange(v => { wip.pull = v as Pull; markDirty() })
		})

	new Setting(el)
		.setName('Start delimiter')
		.setDesc('The string that marks the beginning of the text to extract. For Obsidian highlights, use ==. For bold, use **.')
		.addText(t =>
			t.setValue(wip.start).setPlaceholder('e.g. ==').onChange(v => {
				wip.start = v
				markDirty()
			})
		)

	new Setting(el)
		.setName('End delimiter')
		.setDesc('The string that marks the end of the text to extract. Leave blank to reuse the start delimiter — which is correct for symmetric delimiters like == or **.')
		.addText(t =>
			t.setValue(wip.end).setPlaceholder('Same as start').onChange(v => {
				wip.end = v
				markDirty()
			})
		)

	new Setting(el)
		.setName('Inclusive')
		.setDesc('When enabled, the delimiter characters themselves are included in the result. For example, extracting ==highlight== inclusively gives "==highlight==" rather than "highlight".')
		.addToggle(t => t.setValue(wip.inclusive).onChange(v => { wip.inclusive = v; markDirty() }))

	new Setting(el)
		.setName('Multiline')
		.setDesc('When enabled, the rule can match text that spans across multiple lines. When disabled, the start and end delimiter must appear on the same line.')
		.addToggle(t => t.setValue(wip.multiline).onChange(v => { wip.multiline = v; markDirty() }))
}

function buildHeadingsFields(el: HTMLElement, wip: ResolvedRule, markDirty: () => void): void {
	new Setting(el)
		.setName('Pull')
		.setDesc('"Heading text" returns just the heading line\'s text. "Full section" returns the heading and all content beneath it. "Count" returns the number of matching headings.')
		.addDropdown(d => {
			d.addOption('text',  'Heading text only')
			d.addOption('first', 'Full section content')
			d.addOption('count', 'Count of matching headings')
			d.setValue(wip.pull).onChange(v => { wip.pull = v as Pull; markDirty() })
		})

	new Setting(el)
		.setName('Target by')
		.setDesc('Match headings by their level (H1–H6) or by their exact text. Level is useful for pulling the first H1 title; text is useful for targeting a specific named section.')
		.addDropdown(d => {
			d.addOption('level', 'Heading level (1–6)')
			d.addOption('text',  'Heading text')
			d.setValue(wip.heading_match).onChange(v => { wip.heading_match = v as HeadingMatch; markDirty() })
		})
		.addText(t =>
			t.setValue(String(wip.heading_value)).setPlaceholder(wip.heading_match === 'level' ? '1–6' : 'Heading text').onChange(v => {
				wip.heading_value = wip.heading_match === 'level' ? parseInt(v) || 1 : v
				markDirty()
			})
		)

	new Setting(el)
		.setName('Include heading line')
		.setDesc('When pulling a full section, include the heading line itself at the top of the result. If disabled, only the content beneath the heading is returned.')
		.addToggle(t => t.setValue(wip.include_heading_line).onChange(v => { wip.include_heading_line = v; markDirty() }))

	new Setting(el)
		.setName('Include subheadings')
		.setDesc('When pulling a full section, include content under lower-level headings within that section. If disabled, only the text between the matched heading and the first sub-heading is returned.')
		.addToggle(t => t.setValue(wip.include_subheadings).onChange(v => { wip.include_subheadings = v; markDirty() }))
}

function buildCalloutsFields(el: HTMLElement, wip: ResolvedRule, markDirty: () => void): void {
	new Setting(el)
		.setName('Pull')
		.setDesc('"First" returns the first matching callout. "All" returns every matching callout as a list. "Count" returns the total number of matching callouts.')
		.addDropdown(d => {
			d.addOption('first', 'First matching callout')
			d.addOption('all',   'All matching callouts')
			d.addOption('count', 'Count of matching callouts')
			d.setValue(wip.pull).onChange(v => { wip.pull = v as Pull; markDirty() })
		})

	new Setting(el)
		.setName('Callout type filter')
		.setDesc('Only match callouts of this type (e.g. "warning", "info", "tip"). Leave blank to match callouts of any type.')
		.addText(t =>
			t.setValue(wip.callout_type).setPlaceholder('Any type').onChange(v => {
				wip.callout_type = v
				markDirty()
			})
		)

	new Setting(el)
		.setName('Extract')
		.setDesc('"Header" returns the callout\'s title line. "Body" returns the content below the title. "Both" returns the full callout including title and body.')
		.addDropdown(d => {
			d.addOption('header', 'Header only')
			d.addOption('body',   'Body only')
			d.addOption('both',   'Header and body')
			d.setValue(wip.extract).onChange(v => { wip.extract = v as CalloutExtract; markDirty() })
		})

	new Setting(el)
		.setName('Include type label')
		.setDesc('When enabled, the "> [!type]" prefix line is included in the result. When disabled, only the human-readable content is returned.')
		.addToggle(t => t.setValue(wip.include_type_label).onChange(v => { wip.include_type_label = v; markDirty() }))
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
