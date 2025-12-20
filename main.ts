import { MarkdownView, Plugin, TFile } from 'obsidian';
import { DEFAULT_SETTINGS, AutoPropertyPluginSettings, AutoPropertiesSettingsTab, AutoPropRule } from "./settings";

export default class AutoPropertyPlugin extends Plugin {
	settings: AutoPropertyPluginSettings;

	// to prevent infinite loops, track when the last update was made
	lastRun: Date

	async onload() {
		await this.loadSettings();

		this.lastRun = new Date();

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'update-all',
			name: 'Update properties across vault',
			callback: () => {
				this.updateAllNotes()
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new AutoPropertiesSettingsTab(this.app, this));

		// The main part of the plugin, listening to file changes & updating properties
		this.registerEvent(this.app.vault.on('modify', (e) => {

			// if manual mode, skip doing anything.
			// Realistically I should probably de-register the event listener
			// but this is easier and has the same effect from what I can tell
			if (this.settings.manualMode) return;

			// Prevent infinite loop by checking time since last update
			const now = new Date();
			const timeDiff = now.getTime() - this.lastRun.getTime();
			if (timeDiff < 2000) {
				// Less than 2 seconds since last update, skip processing
				return;
			}
			this.lastRun = now;

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

			this.applyAllRulesToFile(file, content).catch(e=>console.error(e)).then(()=>{});
		}));
	}

	onunload() {
		// nothing to do
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<AutoPropertyPluginSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	updateAllNotes() {
		const allNotes = this.app.vault.getFiles().filter(file => file.extension === 'md');
		allNotes.forEach(note => this.applyAllRulesToFile(note))
	}

	async applyAllRulesToFile(file: TFile, content?: string) {

		if (!content) content = await this.app.vault.read(file)
		const bodyContent = AutoPropertyPlugin.extractBodyLines(content).join('\n');

		this.app.fileManager.processFrontMatter(file, (frontmatter) => {

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
				const newValue = AutoPropertyPlugin.getValue(matchedProperty, bodyContent);

				// Update frontmatter if the value has changed
				if (frontmatter[key] !== newValue) {
					frontmatter[key] = newValue;
				}
			})
		})
	}

	// async applyAllRulesToFileDANGEROUSLINKVERSION(file: TFile) {
	// Thought here is to enable a "Create link" modifier to make the properties
	// functional links to the blocks they represent. This way you can, in effect,
	// update the property by clicking on it, then changing the source in the note.
	// However - this also opens up the Pandora's Box of **modifying note content**.
	// This would be a valuable thing to be able to do - but would require more work
	// to do safely than I have time for right now.

	// This would have to **replace** the "getValue" approach.
	// You would NOT want to do modify the frontmatter several times in a row 
	// as part of a loop, but all at once - alongside a full body replacement to
	// include link target blockIds

	// You'd need to:
	//  - modify the body of the note to include a ^blockID for each match
	//  - modify all the frontmatter to include the text `[[#^blockId|{}]]`
	//  - make **all** those changes **at once**
	//  - be 100% sure you don't have a bug that deletes content!!!
	//  - stop any infinite modification loops from happening
	// }

	//#region --- Static Helper Methods ---

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

	static extractFrontmatter(fileRawText: string): string {
		const lines = fileRawText.split(/\r\n|\r|\n/);
		if (lines[0] !== '---') {
			return '';
		}
		let i = 1;
		while (i < lines.length && lines[i] !== '---') {
			i++;
		}
		return lines.slice(1, i).join('\n');
	}

	static getValue(autoProp: AutoPropRule, bodyContent: string): string | string[] | number | boolean | undefined {
		const lines = bodyContent.split(/\r\n|\r|\n/);
		let matches: string[] = [];

		matches = lines.filter(line => AutoPropertyPlugin.lineMatchesRule(line, autoProp))

		if (autoProp.rulePartOne === 'count') {
			return matches.length;
		}

		if (matches.length === 0) return ''

		if (autoProp.modifierOmitSearch === 'omit') {
			matches = matches.map(matchedLine => matchedLine.split(autoProp.ruleValue).join(''))
		}

		if (autoProp.modifierWhitespace === 'trim') {
			matches = matches.map(matchedLine => matchedLine.trim())
		}

		// Look for possible block IDs and, if found, convert to links to said blocks
		matches = matches.map(matchedLine => {
			if (!AutoPropertyPlugin.hasLinkTarget(matchedLine)) return matchedLine
			const blockId = AutoPropertyPlugin.extractBlockIdFromLine(matchedLine)
			let valueLessBlockId = matchedLine.split(blockId).join('')
			return `[[#${blockId.trim()}|${valueLessBlockId}]]`
		})

		//a nice to have, if teh ruleValue is an embed, remove the ! from start to better align with obsidian behavior
		if (autoProp.ruleValue.startsWith('!')) matches[0] = matches[0].slice(1);
		if (autoProp.rulePartOne === 'first') {
			return matches[0];
		} else if (autoProp.rulePartOne === 'all') {
			return matches;
		}
	}

	static extractBlockIdFromLine(textLine: string): string {
		const match = textLine.match(/\s+\^\w+$/);
		return match ? match[0] : '';
	}

	static hasLinkTarget(textLine: string): boolean {
		return /\s+\^\w+$/.test(textLine);
	}

	static lineMatchesRule(line: string, autoProp: AutoPropRule): boolean {
		if (autoProp.modifierCaseSensitive === 'insensitive') {
			line = line.toLowerCase();
			autoProp.ruleValue = autoProp.ruleValue.toLowerCase()
		}
		if (autoProp.rulePartTwo === 'startsWith') {
			if (autoProp.modifierWhitespace === 'trim') return line.trim().startsWith(autoProp.ruleValue);
			return line.startsWith(autoProp.ruleValue);
		} else if (autoProp.rulePartTwo === 'contains') {
			return line.includes(autoProp.ruleValue);
		} else if (autoProp.rulePartTwo === 'endsWith') {
			if (autoProp.modifierWhitespace === 'trim') return line.trim().endsWith(autoProp.ruleValue);
			return line.endsWith(autoProp.ruleValue);
		} else if (autoProp.rulePartTwo === 'regex') {
			if (autoProp.modifierWhitespace === 'trim') return new RegExp(autoProp.ruleValue).test(line.trim());
			return new RegExp(autoProp.ruleValue).test(line.trim());
		}
		return false
	}

	//#endregion
}