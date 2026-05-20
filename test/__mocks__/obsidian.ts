// Minimal stubs so imports don't fail during testing.
// Only exports that appear in main.ts or settings.ts imports are needed.

export class Plugin {}
export class PluginSettingTab { constructor(_app: unknown, _plugin: unknown) {} }
export class Notice { constructor(_msg: string) {} }
export class App {}
export class MarkdownView { file: unknown = null }
export class WorkspaceLeaf {}

export class TFolder {
	path = ''
	name = ''
	children: unknown[] = []
	parent: TFolder | null = null
	isRoot() { return false }
	vault: unknown = null
}

export class TFile {
	path = ''
	basename = ''
	extension = ''
	parent: TFolder | null = null
	stat = { ctime: 0, mtime: 0, size: 0 }
}

export class Setting {
	constructor(_containerEl: unknown) {}
	setName(_s: string) { return this }
	setDesc(_s: string) { return this }
	setClass(_s: string) { return this }
	setHeading() { return this }
	addToggle(_cb: (t: { setValue: (v: boolean) => { onChange: (cb: (v: boolean) => void) => void } }) => void) { return this }
	addText(_cb: (t: { setValue: (v: string) => { setPlaceholder: (s: string) => { onChange: (cb: (v: string) => void) => void } } }) => void) { return this }
	addTextArea(_cb: unknown) { return this }
	addDropdown(_cb: unknown) { return this }
}
