import { App, Editor, MarkdownView, Modal, Notice, Plugin, TFile } from 'obsidian';
import { DEFAULT_SETTINGS, AutoPropertyPluginSettings, SampleSettingTab, AutoPropertySetting } from "./settings";

// Remember to rename these classes and interfaces!

export interface AutoProperty {
	key: string;
	function: (bodyContent: string[], frontmatter: any, file: TFile) => any;
}

export default class AutoPropertyPlugin extends Plugin {
	settings: AutoPropertyPluginSettings;

	// to prevent infinite loops, track when the last update was made
	lastRun: Date

	async onload() {
		await this.loadSettings();

		this.lastRun = new Date();

		// This adds an editor command that can perform some operation on the current editor instance
		// this.addCommand({
		// 	id: 'replace-selected',
		// 	name: 'Replace selected content',
		// 	editorCallback: (editor: Editor, view: MarkdownView) => {
		// 		editor.replaceSelection('Sample editor command');
		// 	}
		// });

		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'open-modal-complex',
			name: 'Add auto-property to note',
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						new SampleModal(this.app).open();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
				return false;
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// The main part of the plugin, listening to file changes & updating properties
		this.registerEvent(this.app.vault.on('modify', async (e) => {

			// Prevent infinite loop by checking time since last update
			const now = new Date();
			const timeDiff = now.getTime() - this.lastRun.getTime();
			if (timeDiff < 2000) {
				// Less than 2 seconds since last update, skip processing
				return;
			}
			this.lastRun = now;

			// Obtain path of modified file
			const path = e.path;

			// Safely work toward getting file content and frontmatter
			const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView)
			if (!markdownView) return;

			const file = markdownView.file;
			if (!file) return;

			// Grab content from editor - no need to access disk
			const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
			if (!editor) return

			// Pull directly from editor to ensure we have the latest content
			const content = editor.getDoc().getValue();
			const bodyContent = AutoPropertyPlugin.extractBodyLines(content).join('\n');

			this.app.fileManager.processFrontMatter(file, async (frontmatter) => {

				const keys = Object.keys(frontmatter);

				if (keys.length === 0) {
					return;
				}

				keys.forEach((key) => {

					//check if key is registered with a formula in settings
					//if so, evaluate formula and update frontmatter
					let matchedProperty = this.settings.autopropertySettings.find((autoProp) => {
						return autoProp.key === key && autoProp.enabled;
					})

					if (!matchedProperty) return;

					// Evaluate the function associated with the key
					const newValue = AutoPropertyPlugin.applyRule(matchedProperty, bodyContent);

					// Update frontmatter if the value has changed
					if (frontmatter[key] !== newValue) {
						frontmatter[key] = newValue;
					}
				})
			})
		}));
	}

	onunload() {
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<AutoPropertyPluginSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	static extractBodyLines(fileRawText: string): string[] {

		const lines = fileRawText.split(/\r\n|\r|\n/);
		if (lines[0] !== '---') {
			return lines;
		}
		let i = 1;
		while (i < lines.length && lines[i] !== '---') {
			i++;
		}
		// Skip the closing '---' line
		if (i < lines.length) {
			i++;
		}
		return lines.slice(i);
	}

	static applyRule(autoProp: AutoPropertySetting, bodyContent: string): any {
		const lines = bodyContent.split(/\r\n|\r|\n/);
		let matches: string | any[] = [];

		if (autoProp.rulePartTwo === 'startsWith') {
			matches = lines.filter((line) => {
				if (autoProp.rulePartThree === 'trim') return line.trim().startsWith(autoProp.ruleValue);
				return line.startsWith(autoProp.ruleValue);
			});
		} else if (autoProp.rulePartTwo === 'contains') {
			matches = lines.filter((line) => {
				return line.includes(autoProp.ruleValue);
			});
		} else if (autoProp.rulePartTwo === 'endsWith') {
			matches = lines.filter((line) => {
				if (autoProp.rulePartThree === 'trim') return line.trim().endsWith(autoProp.ruleValue);
				return line.endsWith(autoProp.ruleValue);
			});
		}

		console.log(matches);
		if (autoProp.rulePartOne === 'count') {
			return matches.length;
		}

		if (matches.length === 0) return ''
		
		if(autoProp.rulePartThree === 'trim') matches[0] = matches[0].trim();
		//a nice to have, if teh ruleValue is an embed, remove the ! from start to better align with obsidian behavior
		if(autoProp.ruleValue.startsWith('!')) matches[0] = matches[0].slice(1);
		if (autoProp.rulePartOne === 'first') {
			return matches[0];
		} else if (autoProp.rulePartOne === 'all') {
			return matches;
		}
	}
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		let { contentEl } = this;
		contentEl.setText('#TODO!');
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}