import { App, Notice, PluginSettingTab, Setting } from 'obsidian'
import AutoPropertyPlugin from './main'

export interface AutoPropertyPluginSettings {
	autopropertySettings: AutoPropRule[]
	mode: 'modify' | 'active-leaf-change' | 'manual'
	showNotices: boolean
	pathsToIgnore: string[]
}

export interface AutoPropRule {
	key: string
	enabled: boolean
	rulePartOne: 'first' | 'all' | 'count'
	rulePartTwo: 'startsWith' | 'contains' | 'endsWith' | 'regex'
	ruleValue: string
	modifierWhitespace: 'trim' | 'noTrim'
	modifierOmitSearch: 'none' | 'omit'
	modifierCaseSensitive: 'sensitive' | 'insensitive'
	autoAdd: boolean
	rule: 'built' | 'created' | 'modified' | 'characterCount'
}

export const DEFAULT_SETTINGS: AutoPropertyPluginSettings = {
	autopropertySettings: [],
	mode: 'modify',
	showNotices: true,
	pathsToIgnore: []
}

export class AutoPropertiesSettingsTab extends PluginSettingTab {
	plugin: AutoPropertyPlugin

	constructor (app: App, plugin: AutoPropertyPlugin) {
		super(app, plugin)
		this.plugin = plugin
	}

	display (): void {
		const { containerEl } = this

		containerEl.empty()

		new Setting(containerEl)
			.setName('Rule trigger')
			.setDesc(
				"On file modification, when navigating away, or manual-only via the 'Auto-properties: update auto-properties' command"
			)
			.addDropdown(dropdown => {
				dropdown.addOption('modify', 'On file modification')
				dropdown.addOption('active-leaf-change', 'On file focus change')
				dropdown.addOption('manual', 'Manually via command')
				dropdown
					.setValue(this.plugin.settings.mode)
					.onChange(async value => {
						this.plugin.settings.mode = value as
							| 'modify'
							| 'active-leaf-change'
							| 'manual'
						await this.plugin.saveSettings()
					})
			})

		new Setting(containerEl)
			.setName('Show notices')
			.setDesc(
				'Show a notice every time auto-property values have been updated.'
			)
			.addToggle(toggle => {
				toggle
					.setValue(this.plugin.settings.showNotices)
					.onChange(async value => {
						this.plugin.settings.showNotices = value
						await this.plugin.saveSettings()
					})
			})

		new Setting(containerEl)
			.setName('Ignore paths')
			.setDesc(
				'Do not process auto-properties in these paths. Separate multiple paths with new lines.'
			)
			.addTextArea(text =>
				text
					.setPlaceholder('e.g. resources/templates')
					.setValue(this.plugin.settings.pathsToIgnore.join('\n'))
					.onChange(async value => {
						this.plugin.settings.pathsToIgnore = value
							.split('\n')
							.map(path => path.trim())
						await this.plugin.saveSettings()
					})
			)

		let propertiesHeading = document.createElement('h2')
		propertiesHeading.innerText = 'Auto-properties'
		propertiesHeading.addClass('my-head')
		containerEl.appendChild(propertiesHeading)

		this.plugin.settings.autopropertySettings.forEach((autoProp, index) => {
			// Inflate a panel for each auto-property registered in the settings
			containerEl.appendChild(
				this.createAutoPropertyPanel(autoProp, index)
			)
		})

		// button to create a new blank auto-property
		const addButton = document.createElement('button')
		addButton.setText('Add auto-property')
		addButton.addClass('my-button')
		addButton.onclick = async () => {
			this.plugin.settings.autopropertySettings.push({
				key: '',
				enabled: true,
				rulePartOne: 'first',
				rulePartTwo: 'startsWith',
				ruleValue: '',
				modifierWhitespace: 'trim',
				modifierOmitSearch: 'none',
				modifierCaseSensitive: 'insensitive',
				autoAdd: false,
				rule: 'built'
			})
			await this.plugin.saveSettings()
			this.display() // Refresh the settings tab to show the new property
		}
		containerEl.appendChild(addButton)
	}

	createAutoPropertyPanel (
		autoProp: AutoPropRule,
		index: number
	): HTMLElement {
		let wipAutoProp = {
			key: autoProp.key,
			enabled: autoProp.enabled,
			rulePartOne: autoProp.rulePartOne,
			rulePartTwo: autoProp.rulePartTwo,
			ruleValue: autoProp.ruleValue,
			modifierWhitespace: autoProp.modifierWhitespace,
			modifierOmitSearch: autoProp.modifierOmitSearch,
			modifierCaseSensitive: autoProp.modifierCaseSensitive,
			autoAdd: autoProp.autoAdd,
			rule: autoProp.rule
		}
		const panel = document.createElement('div')
		panel.addClass('property-panel')

		const header = document.createElement('h3')
		header.addClasses(['key-header', 'clickable'])
		header.setCssProps({ 'margin-bottom': '0px' })
		header.innerText = `${autoProp.key || '(no key set)'}`
		panel.appendChild(header)

		const summary = document.createElement('span')
		let headerSummary = makeSummaryText(autoProp)
		summary.innerText = headerSummary
		if (header.innerText === '(no key set)')
			summary.innerText = '- auto-property not configured'
		summary.addClasses(['italic', 'clickable'])
		panel.appendChild(summary)

		const container = document.createElement('div')
		panel.appendChild(container)
		if (header.innerText !== '(no key set)')
			container.setCssProps({ display: 'none' })

		function toggleContainer () {
			if (container.style.display === 'none') {
				container.setCssProps({ display: 'block' })
				summary.setCssProps({ display: 'none' })
			} else {
				container.setCssProps({ display: 'none' })
				summary.setCssProps({ display: 'inline-block' })
			}
		}
		header.onclick = toggleContainer
		summary.onclick = toggleContainer

		//this is used later, but declared here for scoping
		const saveButton = document.createElement('button')
		updateSaveButtonStatus()

		new Setting(container)
			.setName('Property')
			.addText(text =>
				text
					.setValue(autoProp.key)
					.setPlaceholder('Enter property name')
					.onChange(value => {
						wipAutoProp.key = value
						updateSaveButtonStatus()
					})
			)
			.setDesc('The name (key) of the property to run the rule against.')
			.setClass('setting-key')

		const lineRulesContainer = document.createElement('div')
		lineRulesContainer.addClass('rules-container')

		new Setting(container).setName('Rule').addDropdown(dropdown => {
			dropdown.addOption('built', 'Build based on lines in note body')
			dropdown.addOption('created', 'File creation date')
			dropdown.addOption('modified', 'File modification date')
			dropdown.addOption('characterCount', 'Character count of the note body')
			dropdown.setValue(wipAutoProp.rule)
			dropdown.onChange(value => {
				lineRulesContainer.style.display =
					value === 'built' ? 'block' : 'none'
				wipAutoProp.rule = value as
					| 'built'
					| 'created'
					| 'modified'
					| 'characterCount'
				updateSaveButtonStatus()
			})
		})

        if(wipAutoProp.rule !== 'built'){
            lineRulesContainer.style.display = 'none'
        }
		container.appendChild(lineRulesContainer)

		new Setting(lineRulesContainer)
			.setName('Criteria')
			.addDropdown(dropdown => {
				dropdown.addOption('first', 'Pull the first line')
				dropdown.addOption('all', 'Pull all lines')
				dropdown.addOption('count', 'Count the lines')
				dropdown.setValue(wipAutoProp.rulePartOne).onChange(value => {
					wipAutoProp.rulePartOne = value as 'first' | 'all' | 'count'
					updateSaveButtonStatus()
				})
			})
			.addDropdown(dropdown => {
				dropdown.addOption('startsWith', 'Starting with')
				dropdown.addOption('contains', 'Containing')
				dropdown.addOption('endsWith', 'Ending with')
				dropdown.addOption('regex', 'Matching regex')
				dropdown.setValue(wipAutoProp.rulePartTwo).onChange(value => {
					wipAutoProp.rulePartTwo = value as
						| 'startsWith'
						| 'contains'
						| 'endsWith'
						| 'regex'
					updateSaveButtonStatus()
				})
			})
			.addText(text =>
				text
					.setPlaceholder('Enter value for the rule')
					.setValue(autoProp.ruleValue)
					.onChange(value => {
						wipAutoProp.ruleValue = value
						// If regex expressions include the "\", remove them
						if (value.startsWith(`\\`) && value.endsWith(`\\`)) {
							wipAutoProp.ruleValue = value.slice(1, -1)
						}
						updateSaveButtonStatus()
					})
			)

		const modifiersSetting = new Setting(lineRulesContainer).setName(
			'Modifiers'
		)

		const modifierContainer = document.createElement('div')

		modifiersSetting.controlEl.appendChild(modifierContainer)

		new Setting(modifierContainer)
			.setName('Ignore whitespace')
			.addToggle(toggle => {
				toggle
					.setValue(wipAutoProp.modifierWhitespace == 'trim')
					.onChange(value => {
						if (value) {
							wipAutoProp.modifierWhitespace = 'trim'
						} else {
							wipAutoProp.modifierWhitespace = 'noTrim'
						}
					})
			})

		new Setting(modifierContainer)
			.setName('Omit search string from result text')
			.addToggle(toggle => {
				toggle
					.setValue(wipAutoProp.modifierOmitSearch == 'omit')
					.onChange(value => {
						if (value) {
							wipAutoProp.modifierOmitSearch = 'omit'
						} else {
							wipAutoProp.modifierOmitSearch = 'none'
						}
					})
			})

		new Setting(modifierContainer)
			.setName('Case sensitive')
			.addToggle(toggle => {
				toggle
					.setValue(wipAutoProp.modifierCaseSensitive == 'sensitive')
					.onChange(value => {
						if (value) {
							wipAutoProp.modifierCaseSensitive = 'sensitive'
						} else {
							wipAutoProp.modifierCaseSensitive = 'insensitive'
						}
					})
			})

		new Setting(container)
			.setName('Auto-add property to note')
			.setDesc(
				'Automatically add this property to notes when the rule matches'
			)
			.addToggle(toggle => {
				toggle.setValue(wipAutoProp.autoAdd).onChange(value => {
					wipAutoProp.autoAdd = value
				})
			})

		new Setting(container).setName('Enabled').addToggle(toggle =>
			toggle.setValue(autoProp.enabled).onChange(value => {
				wipAutoProp.enabled = value
				updateSaveButtonStatus()
			})
		)

		const buttonContainer = document.createElement('div')
		buttonContainer.addClass('button-container')

		saveButton.setText('Save')
		saveButton.onclick = async () => {
			if (!wipAutoProp.key.trim()) {
				new Notice('Key cannot be blank')
				return
			}
			if (!wipAutoProp.ruleValue.trim() && wipAutoProp.rule === 'built') {
                console.log(wipAutoProp)
				new Notice('Built rules search string must not be blank')
				return
			}
			Object.assign(autoProp, wipAutoProp)
			await this.plugin.saveSettings()
			this.display()
			new Notice('Auto-property saved')
		}
		buttonContainer.appendChild(saveButton)

		const deleteButton = document.createElement('button')
		deleteButton.setText('Delete')
		deleteButton.addClasses(['mod-warning', 'clickable'])
		deleteButton.onclick = async () => {
			this.plugin.settings.autopropertySettings.splice(index, 1)
			await this.plugin.saveSettings()
			this.display()
		}
		buttonContainer.appendChild(deleteButton)
		container.appendChild(buttonContainer)

		// Key setting
		return panel

		//#region --- Local Helper Functions

		function updateSaveButtonStatus () {
			saveButton.addClass('highlight')
		}

		function makeSummaryText (prop: AutoPropRule): string {
			if (!prop.enabled) return '- auto-property not enabled'

			const rulePartOneText = {
				first: 'Pull the first line',
				all: 'Pull all lines',
				count: 'Count the lines'
			}

			const rulePartTwoText = {
				startsWith: 'starting with',
				contains: 'containing',
				endsWith: 'ending with',
				regex: 'matching regex'
			}

			let text = `${rulePartOneText[prop.rulePartOne]} ${
				rulePartTwoText[prop.rulePartTwo]
			}`

			if (prop.rule === 'created') text = 'File creation date'
			if (prop.rule === 'modified') text = 'File modification date'   
			if (prop.rule === 'characterCount') text = 'Character count of the note body'
			if (prop.autoAdd) text += ' (➕ auto-add enabled)'
			return text
		}

		//#endregion
	}
}
