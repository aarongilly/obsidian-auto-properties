import { MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf } from 'obsidian'
import {
	DEFAULT_SETTINGS,
	AutoPropertyPluginSettings,
	AutoPropertiesSettingsTab,
	AutoPropertyRule,
	FileRule,
	LinesRule,
	Trigger,
} from './settings'

export default class AutoPropertyPlugin extends Plugin {
	settings: AutoPropertyPluginSettings

	// Prevents re-entrant modify events triggered by our own frontmatter writes
	private isWriting = false

	// For focus_change trigger: track which file was last active
	private lastActiveFile: TFile | null = null

	async onload() {
		await this.loadSettings()

		this.app.workspace.onLayoutReady(() => {
			this.lastActiveFile = this.app.workspace.getActiveFile()
		})

		// ── Commands ─────────────────────────────────────────────────────────

		this.addCommand({
			id: 'update-current',
			name: 'Update auto-properties',
			checkCallback: (checking: boolean) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView)
				if (!view?.file) return false
				if (!checking) void this.update(view.file, 'manual')
				return true
			}
		})

		this.addCommand({
			id: 'update-all',
			name: 'Update auto-properties for every note in vault',
			callback: () => {
				const files = this.app.vault.getFiles().filter(f => f.extension === 'md')
				new Notice(`Running auto-properties on ${files.length} notes…`)
				files.forEach(f => void this.update(f, 'manual'))
			}
		})

		// ── Settings tab ─────────────────────────────────────────────────────

		this.addSettingTab(new AutoPropertiesSettingsTab(this.app, this))

		// ── Trigger: modification ─────────────────────────────────────────────

		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (this.isWriting) return
				if (!(file instanceof TFile) || file.extension !== 'md') return
				// Only act on the active file — modify fires for all vault files
				const active = this.app.workspace.getActiveFile()
				if (active?.path !== file.path) return
				void this.update(file, 'modification')
			})
		)

		// ── Trigger: open ─────────────────────────────────────────────────────

		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				if (!file || file.extension !== 'md') return
				void this.update(file, 'open')
			})
		)

		// ── Trigger: focus_change ─────────────────────────────────────────────

		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf: WorkspaceLeaf | null) => {
				const previous = this.lastActiveFile
				this.lastActiveFile = this.getFileFromLeaf(leaf)
				if (!previous) return
				void this.update(previous, 'focus_change')
			})
		)
	}

	onunload() { /* nothing to do */ }

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<AutoPropertyPluginSettings>
		)
	}

	async saveSettings() {
		await this.saveData(this.settings)
	}

	// ── Core update method ────────────────────────────────────────────────────

	async update(file: TFile, trigger: Trigger | 'manual') {
		const raw = await this.app.vault.read(file)
		const bodyLines = AutoPropertyPlugin.extractBodyLines(raw)

		let changesCount = 0

		this.isWriting = true
		try {
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				const rulesToRun = this.settings.rules.filter(rule =>
					shouldRun(rule, trigger, frontmatter)
				)

				for (const rule of rulesToRun) {
					const newValue = AutoPropertyPlugin.evaluateRule(rule, bodyLines, file)

					// Skip empty results unless autoadd will create the key
					if ((newValue === '' || newValue === null || newValue === undefined) && !rule.autoadd) continue

					// no_overwrite: skip if key already has a value
					const existing = frontmatter[rule.key]
					if (rule.no_overwrite && existing !== null && existing !== undefined && existing !== '') continue

					// Skip if nothing changed
					if (valuesEqual(existing, newValue)) continue

					frontmatter[rule.key] = newValue
					changesCount++
				}
			})
		} finally {
			// Always clear the flag, even if processFrontMatter throws
			this.isWriting = false
		}

		if (changesCount > 0 && this.settings.showNotices) {
			new Notice(`Auto-properties: updated ${changesCount} ${changesCount === 1 ? 'property' : 'properties'}`)
		}
	}

	// ── Rule evaluation ───────────────────────────────────────────────────────

	static evaluateRule(
		rule: AutoPropertyRule,
		bodyLines: string[],
		file: TFile
	): string | string[] | number | null {
		let result: string | string[] | number | null

		if (rule.type === 'file') {
			result = AutoPropertyPlugin.evaluateFileRule(rule.rule, file)
		} else {
			const boundaries = AutoPropertyPlugin.toBoundaryConditions(rule)
			result = AutoPropertyPlugin.extractBetweenBoundaries(bodyLines, boundaries)
		}

		return AutoPropertyPlugin.applyOutputTransforms(result, rule, file)
	}

	// ── File rule ─────────────────────────────────────────────────────────────

	static evaluateFileRule(rule: FileRule, file: TFile): string | number {
		switch (rule.pull) {
			case 'name':      return file.basename
			case 'path':      return file.path
			case 'folder':    return file.parent?.path ?? ''
			case 'extension': return file.extension
			case 'size':      return file.stat.size
			case 'created':   return formatDate(new Date(file.stat.ctime))
			case 'modified':  return formatDate(new Date(file.stat.mtime))
		}
	}

	// ── Boundary condition translation ────────────────────────────────────────

	static toBoundaryConditions(rule: AutoPropertyRule): BoundaryConditions {
		switch (rule.type) {
			case 'lines':
				return {
					type:         'lines',
					pull:         rule.rule.pull,
					startMatch:   (line) => lineMatchesRule(line, rule.rule, rule.case_sensitive),
					pullNextLine: rule.rule.pull_next_line,
				}

			case 'between':
				return {
					type:       'between',
					pull:       rule.rule.pull,
					startDelim: rule.rule.delimiter,
					endDelim:   rule.rule.end_delimiter || rule.rule.delimiter,
					inclusive:  rule.rule.inclusive,
					multiline:  rule.rule.multiline,
				}

			case 'headings': {
				const targetLevel = typeof rule.rule.value === 'number'
					? rule.rule.value
					: parseInt(String(rule.rule.value)) || 1

				const matchesHeading = (line: string): boolean => {
					if (rule.rule.match === 'level') {
						return new RegExp(`^#{${targetLevel}}\\s`).test(line)
					}
					const text = String(rule.rule.value)
					const stripped = line.replace(/^#+\s+/, '')
					return rule.case_sensitive
						? stripped === text
						: stripped.toLowerCase() === text.toLowerCase()
				}

				const headingLevel = (line: string): number => {
					const m = line.match(/^(#+)\s/)
					return m ? m[1].length : 0
				}

				return {
					type:               'headings',
					pull:               rule.rule.pull,
					matchesHeading,
					headingLevel,
					includeHeadingLine: rule.rule.include_heading_line,
					includeSubheadings: rule.rule.include_subheadings,
				}
			}

			case 'callouts':
				return {
					type:              'callouts',
					pull:              rule.rule.pull,
					calloutTypeFilter: rule.rule.callout_type,
					extract:           rule.rule.extract,
					includeTypeLabel:  rule.rule.include_type_label,
				}
		}
	}

	// ── Core extraction primitive ─────────────────────────────────────────────

	static extractBetweenBoundaries(
		lines: string[],
		boundaries: BoundaryConditions
	): string | string[] | number | null {

		switch (boundaries.type) {

			case 'lines': {
				const matches: string[] = []
				for (let i = 0; i < lines.length; i++) {
					if (boundaries.startMatch(lines[i])) {
						matches.push(boundaries.pullNextLine ? (lines[i + 1] ?? '') : lines[i])
					}
				}
				return collectResults(matches, boundaries.pull)
			}

			case 'between': {
				const { startDelim, endDelim, inclusive, multiline } = boundaries
				const matches: string[] = []

				if (multiline) {
					const full = lines.join('\n')
					const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
					const pattern = new RegExp(
						escaped(startDelim) + '(.*?)' + escaped(endDelim),
						'gs'
					)
					for (const m of full.matchAll(pattern)) {
						matches.push(inclusive ? m[0] : m[1])
					}
				} else {
					for (const line of lines) {
						let searchFrom = 0
						while (true) {
							const start = line.indexOf(startDelim, searchFrom)
							if (start === -1) break
							const contentStart = start + startDelim.length
							const end = line.indexOf(endDelim, contentStart)
							if (end === -1) break
							matches.push(inclusive
								? line.slice(start, end + endDelim.length)
								: line.slice(contentStart, end)
							)
							searchFrom = end + endDelim.length
						}
					}
				}
				return collectResults(matches, boundaries.pull)
			}

			case 'headings': {
				const { matchesHeading, headingLevel, includeHeadingLine, includeSubheadings, pull } = boundaries
				const results: string[] = []

				for (let i = 0; i < lines.length; i++) {
					if (!matchesHeading(lines[i])) continue

					if (pull === 'text') {
						results.push(lines[i].replace(/^#+\s+/, ''))
						continue
					}

					// Section pull: collect lines until next same-or-higher heading
					const targetLevel = headingLevel(lines[i])
					const section: string[] = []
					if (includeHeadingLine) section.push(lines[i])

					for (let j = i + 1; j < lines.length; j++) {
						const lvl = headingLevel(lines[j])
						if (lvl > 0 && lvl <= targetLevel) break
						if (!includeSubheadings && lvl > 0) break
						section.push(lines[j])
					}
					results.push(section.join('\n').trim())
				}

				return collectResults(results, pull === 'count' ? 'count' : pull as 'first' | 'all')
			}

			case 'callouts': {
				const { calloutTypeFilter, extract, includeTypeLabel, pull } = boundaries
				const results: string[] = []

				for (let i = 0; i < lines.length; i++) {
					const headerMatch = lines[i].match(/^>\s*\[!(\w+)\](.*)$/i)
					if (!headerMatch) continue

					const calloutType = headerMatch[1]
					if (calloutTypeFilter && calloutType.toLowerCase() !== calloutTypeFilter.toLowerCase()) continue

					const headerTitle = headerMatch[2].trim()

					// Collect body: contiguous lines starting with ">"
					const bodyLines: string[] = []
					for (let j = i + 1; j < lines.length; j++) {
						if (!lines[j].startsWith('>')) break
						bodyLines.push(lines[j].replace(/^>\s?/, ''))
					}

					const parts: string[] = []
					if (extract === 'header' || extract === 'both') {
						parts.push(includeTypeLabel ? lines[i] : headerTitle)
					}
					if (extract === 'body' || extract === 'both') {
						parts.push(...bodyLines)
					}

					results.push(parts.join('\n').trim())
				}

				return collectResults(results, pull)
			}
		}
	}

	// ── Output transforms ─────────────────────────────────────────────────────

	static applyOutputTransforms(
		value: string | string[] | number | null,
		rule: AutoPropertyRule,
		file: TFile
	): string | string[] | number | null {
		if (value === null || value === undefined) return null
		if (typeof value === 'number') return value

		if (Array.isArray(value)) {
			return value.map(v => transformString(v, rule, file))
		}
		return transformString(value, rule, file)
	}

	// ── Body extraction ───────────────────────────────────────────────────────

	static extractBodyLines(raw: string): string[] {
		const lines = raw.split(/\r\n|\r|\n/)
		if (lines[0] !== '---') return lines
		let i = 1
		while (i < lines.length && lines[i] !== '---') i++
		if (i < lines.length) i++ // skip closing ---
		return lines.slice(i)
	}

	// ── Private helpers ───────────────────────────────────────────────────────

	private getFileFromLeaf(leaf: WorkspaceLeaf | null): TFile | null {
		if (!leaf) return null
		const view = leaf.view
		return view instanceof MarkdownView ? view.file : null
	}
}

// ── Boundary condition types ──────────────────────────────────────────────────

type BoundaryConditions =
	| {
		type: 'lines'
		pull: 'first' | 'all' | 'count'
		startMatch: (line: string) => boolean
		pullNextLine: boolean
	}
	| {
		type: 'between'
		pull: 'first' | 'all' | 'count'
		startDelim: string
		endDelim: string
		inclusive: boolean
		multiline: boolean
	}
	| {
		type: 'headings'
		pull: 'first' | 'all' | 'count' | 'text' | 'section'
		matchesHeading: (line: string) => boolean
		headingLevel: (line: string) => number
		includeHeadingLine: boolean
		includeSubheadings: boolean
	}
	| {
		type: 'callouts'
		pull: 'first' | 'all' | 'count'
		calloutTypeFilter: string
		extract: 'header' | 'body' | 'both'
		includeTypeLabel: boolean
	}

// ── Module-level pure helpers ─────────────────────────────────────────────────

function shouldRun(
	rule: AutoPropertyRule,
	trigger: Trigger | 'manual',
	frontmatter: Record<string, unknown>
): boolean {
	if (!rule.enabled) return false
	if (trigger !== 'manual' && !rule.trigger.includes(trigger)) return false

	const keyExists = Object.prototype.hasOwnProperty.call(frontmatter, rule.key)
	if (!keyExists && !rule.autoadd) return false

	return true
}

function lineMatchesRule(line: string, rule: LinesRule, caseSensitive: boolean): boolean {
	const haystack = caseSensitive ? line        : line.toLowerCase()
	const needle   = caseSensitive ? rule.value  : rule.value.toLowerCase()
	const trimmed  = haystack.trim()

	switch (rule.match) {
		case 'starting_with': return trimmed.startsWith(needle)
		case 'ending_with':   return trimmed.endsWith(needle)
		case 'containing':    return haystack.includes(needle)
		case 'regex':         return new RegExp(rule.value, caseSensitive ? '' : 'i').test(line)
	}
}

function collectResults(
	matches: string[],
	pull: 'first' | 'all' | 'count' | 'text' | 'section'
): string | string[] | number | null {
	if (pull === 'count') return matches.length
	if (matches.length === 0) return null
	if (pull === 'first' || pull === 'text') return matches[0]
	return matches // 'all' | 'section'
}

function transformString(value: string, rule: AutoPropertyRule, file: TFile): string {
	let v = value
	if (rule.trim_whitespace) v = v.trim()
	if (rule.strip_markdown)  v = stripMarkdown(v)
	if (rule.format)          v = applyFormat(v, rule, file)
	return v
}

function applyFormat(result: string, rule: AutoPropertyRule, file: TFile): string {
	const placeholders: Record<string, string> = {
		result,
		filename: file.basename,
		folder:   file.parent?.path ?? '',
		path:     file.path,
		created:  formatDate(new Date(file.stat.ctime)),
		modified: formatDate(new Date(file.stat.mtime)),
	}
	return rule.format.replace(/\$\{(\w+)\}/g, (match, key) =>
		placeholders[key] ?? match
	)
}

function stripMarkdown(text: string): string {
	return text
		.replace(/\*\*(.*?)\*\*/g, '$1')                // bold
		.replace(/\*(.*?)\*/g, '$1')                    // italic
		.replace(/~~(.*?)~~/g, '$1')                    // strikethrough
		.replace(/`(.*?)`/g, '$1')                      // inline code
		.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2') // wiki link with alias → alias
		.replace(/\[\[([^\]]+)\]\]/g, '$1')             // wiki link → target
		.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')       // markdown link → label
		.replace(/^#{1,6}\s+/gm, '')                    // headings
		.replace(/^[-*+]\s+/gm, '')                     // list bullets
		.replace(/^>\s*/gm, '')                         // blockquotes
		.trim()
}

function valuesEqual(a: unknown, b: string | string[] | number | null): boolean {
	if (a === b) return true
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((v, i) => v === b[i])
	}
	if (a !== null && b !== null) return String(a) === String(b)
	return false
}

function formatDate(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0')
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
		`T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
