import { App, Notice, PluginSettingTab, Setting } from 'obsidian'
import AutoPropertyPlugin from './main'

export interface AutoPropertyPluginSettings {
	rules: AutoPropertyRule[]
	showNotices: boolean
}

// ── Shared primitives ────────────────────────────────────────────────────────

export type Trigger = 'modification' | 'focus_change' | 'open'
export type Pull = 'first' | 'all' | 'count'

// ── Rule types ───────────────────────────────────────────────────────────────

export type FilePull = 'created' | 'modified' | 'size' | 'path' | 'folder' | 'name' | 'extension'

export interface FileRule {
	pull: FilePull
}

export type LineMatch = 'starting_with' | 'ending_with' | 'containing' | 'regex'

export interface LinesRule {
	pull: Pull
	match: LineMatch
	value: string
	pull_next_line: boolean
}

export type HeadingPull = 'section' | 'text' | 'count'
export type HeadingMatch = 'text' | 'level'

export interface HeadingsRule {
	pull: HeadingPull
	match: HeadingMatch
	value: string | number
	include_heading_line: boolean
	include_subheadings: boolean
}

export type CalloutExtract = 'header' | 'body' | 'both'

export interface CalloutsRule {
	pull: Pull
	callout_type: string
	extract: CalloutExtract
	include_type_label: boolean
}

export interface BetweenRule {
	pull: Pull
	delimiter: string
	end_delimiter: string   // if same as delimiter, user leaves blank; logic handles it
	inclusive: boolean
	multiline: boolean
}

// ── Discriminated union ──────────────────────────────────────────────────────

export type RuleType =
	| { type: 'file';     rule: FileRule }
	| { type: 'lines';    rule: LinesRule }
	| { type: 'between';  rule: BetweenRule }
	| { type: 'headings'; rule: HeadingsRule }
	| { type: 'callouts'; rule: CalloutsRule }

// ── Top-level rule ───────────────────────────────────────────────────────────

export type AutoPropertyRule = {
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
} & RuleType

// ── Default rule factories ───────────────────────────────────────────────────

function defaultRuleFor(type: AutoPropertyRule['type']): RuleType {
	switch (type) {
		case 'file':     return { type: 'file',     rule: { pull: 'name' } }
		case 'lines':    return { type: 'lines',    rule: { pull: 'first', match: 'starting_with', value: '', pull_next_line: false } }
		case 'between':  return { type: 'between',  rule: { pull: 'first', delimiter: '==', end_delimiter: '', inclusive: false, multiline: false } }
		case 'headings': return { type: 'headings', rule: { pull: 'text', match: 'level', value: 1, include_heading_line: false, include_subheadings: true } }
		case 'callouts': return { type: 'callouts', rule: { pull: 'first', callout_type: '', extract: 'body', include_type_label: false } }
	}
}

export const DEFAULT_RULE: AutoPropertyRule = {
	key: '',
	enabled: true,
	autoadd: false,
	no_overwrite: false,
	trigger: [],
	whererun: [],
	whereignore: [],
	strip_markdown: false,
	trim_whitespace: true,
	case_sensitive: false,
	format: '',
	type: 'lines',
	rule: { pull: 'first', match: 'starting_with', value: '', pull_next_line: false }
}

export const DEFAULT_SETTINGS: AutoPropertyPluginSettings = {
	rules: [],
	showNotices: true
}

// ── Settings Tab ─────────────────────────────────────────────────────────────

export class AutoPropertiesSettingsTab extends PluginSettingTab {
	plugin: AutoPropertyPlugin

	constructor(app: App, plugin: AutoPropertyPlugin) {
		super(app, plugin)
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
			this.plugin.settings.rules.push({ ...DEFAULT_RULE })
			await this.plugin.saveSettings()
			this.display()
		}
		containerEl.appendChild(addButton)
	}

	createAutoPropertyPanel(autoProp: AutoPropertyRule, index: number): HTMLElement {
		// Deep clone so edits don't touch live settings until Save
		let wip: AutoPropertyRule = JSON.parse(JSON.stringify(autoProp))

		// Per-type rule cache: preserves rule data when user switches types without saving
		const ruleCache: Partial<Record<AutoPropertyRule['type'], RuleType['rule']>> = {
			[autoProp.type]: autoProp.rule as RuleType['rule']
		}

		// ── Panel shell ──────────────────────────────────────────────────────

		const panel = document.createElement('div')
		panel.addClass('property-panel')

		// Header: key name, clickable to expand/collapse
		const header = document.createElement('h3')
		header.addClasses(['key-header', 'clickable', 'mb-0'])
		header.innerText = autoProp.key ? autoProp.key : '✦ New auto-property'
		panel.appendChild(header)

		const summary = document.createElement('span')
		summary.innerText = autoProp.key ? makeSummaryText(autoProp) : '— click to configure'
		summary.addClasses(['italic', 'clickable'])
		panel.appendChild(summary)

		// Collapsible container
		const container = document.createElement('div')
		panel.appendChild(container)
		if (autoProp.key) container.addClass('hide')

		// JSON/GUI mode toggle — lives inside container so it's hidden when collapsed
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

		// ── Two views inside container ───────────────────────────────────────

		const guiView  = document.createElement('div')
		const jsonView = document.createElement('div')
		container.appendChild(guiView)
		container.appendChild(jsonView)
		jsonView.addClass('hide')

		// ── Save / Delete buttons (shared between modes) ─────────────────────

		const buttonContainer = document.createElement('div')
		buttonContainer.addClass('button-container')

		const saveButton = document.createElement('button')
		saveButton.setText('Save')
		saveButton.onclick = async () => {
			if (jsonMode) {
				// Parse JSON → wip, then validate
				const parsed = tryParseRuleJson(jsonEditor.value)
				if (!parsed) {
					new Notice('Invalid JSON — please fix before saving.')
					return
				}
				wip = parsed
			}
			if (!wip.key.trim()) {
				new Notice('Key cannot be blank.')
				return
			}
			Object.assign(autoProp, wip)
			this.plugin.settings.rules[index] = wip
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

		// Mark save button dirty on any wip change
		function markDirty() { saveButton.addClass('highlight') }

		// ── JSON view ────────────────────────────────────────────────────────

		const jsonEditor = document.createElement('textarea')
		jsonEditor.style.width = '100%'
		jsonEditor.style.minHeight = '260px'
		jsonEditor.style.fontFamily = 'monospace'
		jsonEditor.style.fontSize = 'var(--font-smallest)'
		jsonEditor.style.marginTop = '8px'
		jsonEditor.onchange = markDirty
		jsonView.appendChild(jsonEditor)

		// ── Mode toggle logic ────────────────────────────────────────────────

		modeToggle.onclick = () => {
			jsonMode = !jsonMode
			if (jsonMode) {
				// GUI → JSON: serialize current wip into the textarea
				jsonEditor.value = JSON.stringify(wip, null, 2)
				guiView.addClass('hide')
				jsonView.removeClass('hide')
				modeToggle.setText('⚙ GUI')
			} else {
				// JSON → GUI: attempt to parse, warn if invalid
				const parsed = tryParseRuleJson(jsonEditor.value)
				if (!parsed) {
					new Notice('Invalid JSON — fix it before switching back.')
					return
				}
				wip = parsed
				guiView.removeClass('hide')
				jsonView.addClass('hide')
				modeToggle.setText('{ } JSON')
				rebuildGuiView()
			}
		}

		// ── GUI view builder ─────────────────────────────────────────────────
		// Extracted as a function so it can be called after JSON→GUI switch

		const rebuildGuiView = () => {
			guiView.empty()

			// ── Common fields ────────────────────────────────────────────────

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
						const newType = value as AutoPropertyRule['type']
						ruleCache[wip.type] = wip.rule as RuleType['rule']
						const cached = ruleCache[newType]
						if (cached) {
							;(wip as any) = { ...wip, type: newType, rule: cached }
						} else {
							const defaults = defaultRuleFor(newType)
							;(wip as any) = { ...wip, ...defaults }
						}
						markDirty()
						rebuildGuiView()
					})
				})

			// ── Type-specific fields ─────────────────────────────────────────

			const ruleSection = document.createElement('div')
			ruleSection.addClass('rules-container')
			guiView.appendChild(ruleSection)
			buildRuleFields(ruleSection, wip, markDirty)

			// ── Output ───────────────────────────────────────────────────────

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

			// ── Behaviour ────────────────────────────────────────────────────

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

			// ── Triggers ─────────────────────────────────────────────────────

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

			// ── Where to run ─────────────────────────────────────────────────

			new Setting(guiView).setName('Scope').setHeading()

			new Setting(guiView)
				.setName('Run in folders')
				.setDesc('Only run in these folders (and subfolders). Leave blank for entire vault.')
				.addTextArea(t =>
					t.setValue(wip.whererun.join('\n')).setPlaceholder('e.g. /projects').onChange(v => {
						wip.whererun = v.split('\n').map(s => s.trim()).filter(Boolean)
						markDirty()
					})
				)

			new Setting(guiView)
				.setName('Ignore folders')
				.setDesc('Never run in these folders (and subfolders).')
				.addTextArea(t =>
					t.setValue(wip.whereignore.join('\n')).setPlaceholder('e.g. /templates').onChange(v => {
						wip.whereignore = v.split('\n').map(s => s.trim()).filter(Boolean)
						markDirty()
					})
				)

			guiView.appendChild(buttonContainer)
		}

		// Initial render
		rebuildGuiView()

		return panel
	}
}

// ── Type-specific rule field builders ────────────────────────────────────────

function buildRuleFields(container: HTMLElement, wip: AutoPropertyRule, markDirty: () => void): void {
	switch (wip.type) {
		case 'file':     buildFileFields(container, wip.rule, markDirty);     break
		case 'lines':    buildLinesFields(container, wip.rule, markDirty);    break
		case 'between':  buildBetweenFields(container, wip.rule, markDirty);  break
		case 'headings': buildHeadingsFields(container, wip.rule, markDirty); break
		case 'callouts': buildCalloutsFields(container, wip.rule, markDirty); break
	}
}

function buildFileFields(el: HTMLElement, rule: FileRule, markDirty: () => void): void {
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
			Object.entries(options).forEach(([v, l]) => d.addOption(v, l))
			d.setValue(rule.pull).onChange(v => { rule.pull = v as FilePull; markDirty() })
		})
}

function buildLinesFields(el: HTMLElement, rule: LinesRule, markDirty: () => void): void {
	new Setting(el)
		.setName('Pull')
		.setDesc('"First" returns only the first matched line. "All" returns every matched line as a list. "Count" returns the number of matched lines as a number.')
		.addDropdown(d => {
			d.addOption('first', 'First matching line')
			d.addOption('all',   'All matching lines')
			d.addOption('count', 'Count of matching lines')
			d.setValue(rule.pull).onChange(v => { rule.pull = v as Pull; markDirty() })
		})

	new Setting(el)
		.setName('Match')
		.setDesc('How to compare each line against the search string below. "Containing" is the most flexible — it matches any line that includes the string anywhere within it.')
		.addDropdown(d => {
			d.addOption('starting_with', 'Starting with')
			d.addOption('ending_with',   'Ending with')
			d.addOption('containing',    'Containing')
			d.addOption('regex',         'Matching regex')
			d.setValue(rule.match).onChange(v => { rule.match = v as LineMatch; markDirty() })
		})
		.addText(t =>
			t.setValue(rule.value).setPlaceholder('Search string').onChange(v => {
				rule.value = v
				markDirty()
			})
		)

	new Setting(el)
		.setName('Pull next line')
		.setDesc('Instead of returning the matched line itself, return the line immediately after it. Useful when your note uses label lines like "Status:" followed by the actual value on the next line.')
		.addToggle(t => t.setValue(rule.pull_next_line).onChange(v => { rule.pull_next_line = v; markDirty() }))
}

function buildBetweenFields(el: HTMLElement, rule: BetweenRule, markDirty: () => void): void {
	new Setting(el)
		.setName('Pull')
		.setDesc('"First" returns the first match only. "All" returns every match as a list. "Count" returns the total number of matches as a number.')
		.addDropdown(d => {
			d.addOption('first', 'First match')
			d.addOption('all',   'All matches')
			d.addOption('count', 'Count of matches')
			d.setValue(rule.pull).onChange(v => { rule.pull = v as Pull; markDirty() })
		})

	new Setting(el)
		.setName('Start delimiter')
		.setDesc('The string that marks the beginning of the text to extract. For Obsidian highlights, use ==. For bold, use **.')
		.addText(t =>
			t.setValue(rule.delimiter).setPlaceholder('e.g. ==').onChange(v => {
				rule.delimiter = v
				markDirty()
			})
		)

	new Setting(el)
		.setName('End delimiter')
		.setDesc('The string that marks the end of the text to extract. Leave blank to reuse the start delimiter — which is correct for symmetric delimiters like == or **.')
		.addText(t =>
			t.setValue(rule.end_delimiter).setPlaceholder('Same as start').onChange(v => {
				rule.end_delimiter = v
				markDirty()
			})
		)

	new Setting(el)
		.setName('Inclusive')
		.setDesc('When enabled, the delimiter characters themselves are included in the result. For example, extracting ==highlight== inclusively gives "==highlight==" rather than "highlight".')
		.addToggle(t => t.setValue(rule.inclusive).onChange(v => { rule.inclusive = v; markDirty() }))

	new Setting(el)
		.setName('Multiline')
		.setDesc('When enabled, the rule can match text that spans across multiple lines. When disabled, the start and end delimiter must appear on the same line.')
		.addToggle(t => t.setValue(rule.multiline).onChange(v => { rule.multiline = v; markDirty() }))
}

function buildHeadingsFields(el: HTMLElement, rule: HeadingsRule, markDirty: () => void): void {
	new Setting(el)
		.setName('Pull')
		.setDesc('"Heading text" returns just the heading line\'s text. "Full section" returns the heading and all content beneath it until the next same-or-higher-level heading. "Count" returns the number of matching headings.')
		.addDropdown(d => {
			d.addOption('text',    'Heading text only')
			d.addOption('section', 'Full section content')
			d.addOption('count',   'Count of matching headings')
			d.setValue(rule.pull).onChange(v => { rule.pull = v as HeadingPull; markDirty() })
		})

	new Setting(el)
		.setName('Target by')
		.setDesc('Match headings by their level (H1–H6) or by their exact text. Level is useful for pulling the first H1 title; text is useful for targeting a specific named section.')
		.addDropdown(d => {
			d.addOption('level', 'Heading level (1–6)')
			d.addOption('text',  'Heading text')
			d.setValue(rule.match).onChange(v => { rule.match = v as HeadingMatch; markDirty() })
		})
		.addText(t =>
			t.setValue(String(rule.value)).setPlaceholder(rule.match === 'level' ? '1–6' : 'Heading text').onChange(v => {
				rule.value = rule.match === 'level' ? parseInt(v) || 1 : v
				markDirty()
			})
		)

	new Setting(el)
		.setName('Include heading line')
		.setDesc('When pulling a full section, include the heading line itself at the top of the result. If disabled, only the content beneath the heading is returned.')
		.addToggle(t => t.setValue(rule.include_heading_line).onChange(v => { rule.include_heading_line = v; markDirty() }))

	new Setting(el)
		.setName('Include subheadings')
		.setDesc('When pulling a full section, include content under lower-level headings within that section. If disabled, only the text between the matched heading and the first sub-heading is returned.')
		.addToggle(t => t.setValue(rule.include_subheadings).onChange(v => { rule.include_subheadings = v; markDirty() }))
}

function buildCalloutsFields(el: HTMLElement, rule: CalloutsRule, markDirty: () => void): void {
	new Setting(el)
		.setName('Pull')
		.setDesc('"First" returns the first matching callout. "All" returns every matching callout as a list. "Count" returns the total number of matching callouts.')
		.addDropdown(d => {
			d.addOption('first', 'First matching callout')
			d.addOption('all',   'All matching callouts')
			d.addOption('count', 'Count of matching callouts')
			d.setValue(rule.pull).onChange(v => { rule.pull = v as Pull; markDirty() })
		})

	new Setting(el)
		.setName('Callout type filter')
		.setDesc('Only match callouts of this type (e.g. "warning", "info", "tip"). Leave blank to match callouts of any type.')
		.addText(t =>
			t.setValue(rule.callout_type).setPlaceholder('Any type').onChange(v => {
				rule.callout_type = v
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
			d.setValue(rule.extract).onChange(v => { rule.extract = v as CalloutExtract; markDirty() })
		})

	new Setting(el)
		.setName('Include type label')
		.setDesc('When enabled, the "> [!type]" prefix line is included in the result. When disabled, only the human-readable content is returned.')
		.addToggle(t => t.setValue(rule.include_type_label).onChange(v => { rule.include_type_label = v; markDirty() }))
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function tryParseRuleJson(raw: string): AutoPropertyRule | null {
	try {
		const parsed = JSON.parse(raw)
		// Minimal sanity checks — full validation can be added later
		if (typeof parsed !== 'object' || !parsed.key || !parsed.type || !parsed.rule) return null
		return parsed as AutoPropertyRule
	} catch {
		return null
	}
}

function makeSummaryText(rule: AutoPropertyRule): string {
	if (!rule.enabled) return '— disabled'

	switch (rule.type) {
		case 'file':     return `File → ${rule.rule.pull}`
		case 'lines':    return `Lines → ${rule.rule.pull} ${rule.rule.match} "${rule.rule.value}"`
		case 'between':  return `Between → ${rule.rule.pull} between "${rule.rule.delimiter}"`
		case 'headings': return `Headings → ${rule.rule.pull} (${rule.rule.match}: ${rule.rule.value})`
		case 'callouts': return `Callouts → ${rule.rule.pull}${rule.rule.callout_type ? ` [!${rule.rule.callout_type}]` : ''} (${rule.rule.extract})`
	}
}
