import { MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf } from 'obsidian'
import {
	DEFAULT_SETTINGS,
	AutoPropertyPluginSettings,
	AutoPropertiesSettingsTab,
	AutoPropertyRule,
	ResolvedRule,
	RuleType,
	Pull,
	Trigger,
	flattenRule,
	applyDefaults,
} from './settings'
import { t, tf } from './i18n'

export default class AutoPropertyPlugin extends Plugin {
	settings: AutoPropertyPluginSettings = DEFAULT_SETTINGS

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
				new Notice(tf('notice_rules_running', { count: files.length }))
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
				if (this.isWriting) return
				if (!file || file.extension !== 'md') return
				void this.update(file, 'open')
			})
		)

		// ── Trigger: focus_change ─────────────────────────────────────────────

		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf: WorkspaceLeaf | null) => {
				const previous = this.lastActiveFile
				this.lastActiveFile = this.getFileFromLeaf(leaf)
				if (this.isWriting || !previous) return
				void this.update(previous, 'focus_change')
			})
		)
	}

	onunload() { /* nothing to do */ }

	async loadSettings() {
		const data = (await this.loadData()) as Partial<AutoPropertyPluginSettings>
		if (data?.rules) {
			data.rules = data.rules.map(r => migrateRule(r as unknown as Record<string, unknown>))
		}
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data)
	}

	async saveSettings() {
		await this.saveData(this.settings)
	}

	// ── Core update method ────────────────────────────────────────────────────

	async update(file: TFile, trigger: Trigger | 'manual') {
		const raw = await this.app.vault.read(file)
		const bodyLines = AutoPropertyPlugin.extractBodyLines(raw)
		
		let changesCount = 0
		const writtenKeys = new Set<string>()

		this.isWriting = true
		try {
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				const rulesToRun = this.settings.rules.filter(rule =>
					shouldRun(rule, trigger, frontmatter, file)
				)

				for (const rawRule of rulesToRun) {
					const rule = applyDefaults(flattenRule(rawRule as unknown as Record<string, unknown>))

					// First non-empty result wins per key
					if (writtenKeys.has(rule.key)) continue

					const newValue = AutoPropertyPlugin.evaluateRule(rule, bodyLines, file)
					const existing = frontmatter[rule.key]

					// no_overwrite: skip if key already has a value
					if (rule.no_overwrite && existing !== null && existing !== undefined && existing !== '') continue

					// Empty result: clear the property if the key exists and currently has a value
					if (newValue === '' || newValue === null || newValue === undefined) {
						const keyExists = Object.prototype.hasOwnProperty.call(frontmatter, rule.key)
						if (keyExists && existing !== null && existing !== undefined && existing !== '') {
							frontmatter[rule.key] = null
							writtenKeys.add(rule.key)
							changesCount++
						}
						continue
					}

					// Skip if nothing changed
					if (valuesEqual(existing, newValue)) continue

					frontmatter[rule.key] = newValue
					writtenKeys.add(rule.key)
					changesCount++
				}
			})
		} finally {
			// Always clear the flag, even if processFrontMatter throws
			this.isWriting = false
		}

		if (changesCount > 0 && this.settings.showNotices) {
			new Notice(changesCount === 1
					? t('notice_updated_one')
					: tf('notice_updated_many', { count: changesCount })
				)
		}
	}

	// ── Rule evaluation ───────────────────────────────────────────────────────

	static evaluateRule(
		rule: ResolvedRule,
		bodyLines: string[],
		file: TFile
	): string | string[] | number | null {
		let result: string | string[] | number | null

		if (rule.type === 'file') {
			result = AutoPropertyPlugin.evaluateFileRule(rule, file)
		} else {
			const boundaries = AutoPropertyPlugin.toBoundaryConditions(rule)
			result = AutoPropertyPlugin.extractBetweenBoundaries(bodyLines, boundaries)
		}

		return AutoPropertyPlugin.applyOutputTransforms(result, rule, file)
	}

	// ── File rule ─────────────────────────────────────────────────────────────

	static evaluateFileRule(rule: ResolvedRule, file: TFile): string | number {
		switch (rule.file_pull) {
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

	static toBoundaryConditions(rule: ResolvedRule): BoundaryConditions {
		switch (rule.type) {
			case 'lines':
				return {
					type:         'lines',
					pull:         rule.pull,
					startMatch:   (line) => lineMatchesRule(line, rule),
					pullNextLine: rule.pull_next,
				}

			case 'between':
				return {
					type:       'between',
					pull:       rule.pull,
					startDelim: rule.start,
					endDelim:   rule.end || rule.start,
					inclusive:  rule.inclusive,
					multiline:  rule.multiline,
				}

			case 'headings': {
				const matchesHeading = (line: string): boolean => {
					if (rule.heading_match === 'level') {
						const level = typeof rule.heading_value === 'number'
							? rule.heading_value
							: parseInt(String(rule.heading_value)) || 1
						return new RegExp(`^#{${level}}\\s`).test(line)
					}
					const text = String(rule.heading_value)
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
					pull:               rule.pull,
					matchesHeading,
					headingLevel,
					includeHeadingLine: rule.include_heading_line,
					includeSubheadings: rule.include_subheadings,
				}
			}

			case 'callouts':
				return {
					type:              'callouts',
					pull:              rule.pull,
					calloutTypeFilter: rule.callout_type,
					extract:           rule.extract,
					includeTypeLabel:  rule.include_type_label,
				}

			default:
				// file type is handled before this is called
				throw new Error(`toBoundaryConditions called with type: ${(rule as ResolvedRule).type}`)
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
				if (!startDelim) return null
				const matches: string[] = []
				// When retaining delimiters, ![[ → [[ so the result is a clickable link, not an embed.
				// Also strip pure size aliases (|500 or |500x300) from image embeds — they break links.
				const fixEmbed = (s: string) => {
					if (startDelim !== '![[') return s
					let r = inclusive ? s.replace(/^!/, '') : s
					return r.replace(/\|\d+(x\d+)?(?=\]|$)/i, '')
				}

				if (multiline) {
					const full = lines.join('\n')
					const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
					const pattern = new RegExp(
						escaped(startDelim) + '(.*?)' + escaped(endDelim),
						'gs'
					)
					for (const m of full.matchAll(pattern)) {
						matches.push(fixEmbed(inclusive ? m[0] : m[1]))
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
							matches.push(fixEmbed(inclusive
								? line.slice(start, end + endDelim.length)
								: line.slice(contentStart, end)
							))
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

				return collectResults(results, pull === 'count' ? 'count' : (pull === 'first' || pull === 'text' ? 'first' : 'all'))
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
		rule: ResolvedRule,
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
		pull: Pull
		startMatch: (line: string) => boolean
		pullNextLine: boolean
	}
	| {
		type: 'between'
		pull: Pull
		startDelim: string
		endDelim: string
		inclusive: boolean
		multiline: boolean
	}
	| {
		type: 'headings'
		pull: Pull
		matchesHeading: (line: string) => boolean
		headingLevel: (line: string) => number
		includeHeadingLine: boolean
		includeSubheadings: boolean
	}
	| {
		type: 'callouts'
		pull: Pull
		calloutTypeFilter: string
		extract: 'header' | 'body' | 'both'
		includeTypeLabel: boolean
	}

// ── Migration from nested schema ──────────────────────────────────────────────

export function migrateRule(raw: Record<string, unknown>): AutoPropertyRule {
	// Already flat format (no nested `rule` sub-object)
	if (typeof raw.rule !== 'object' || raw.rule === null) {
		return raw as unknown as AutoPropertyRule
	}

	const sub = raw.rule as Record<string, unknown>
	const type = String(raw.type ?? 'lines') as RuleType
	const migrated: Record<string, unknown> = {}

	// Copy top-level fields (excluding the old `rule` sub-object)
	for (const k of Object.keys(raw)) {
		if (k !== 'rule') migrated[k] = raw[k]
	}

	// Promote sub-rule fields with any necessary renames
	if (type === 'file') {
		migrated.file_pull = sub.pull
	} else {
		if (sub.pull !== undefined) migrated.pull = sub.pull
	}

	if (type === 'lines') {
		if (sub.match       !== undefined) migrated.match              = sub.match
		if (sub.value       !== undefined) migrated.value              = sub.value
		if (sub.pull_next_line !== undefined) migrated.pull_next       = sub.pull_next_line
		if (sub.omit_match  !== undefined) migrated.omit_match         = sub.omit_match
		if (sub.ignore_indentation !== undefined) migrated.ignore_indentation = sub.ignore_indentation
	}

	if (type === 'between') {
		if (sub.delimiter     !== undefined) migrated.start   = sub.delimiter
		if (sub.end_delimiter !== undefined) migrated.end     = sub.end_delimiter
		if (sub.inclusive     !== undefined) migrated.inclusive = sub.inclusive
		if (sub.multiline     !== undefined) migrated.multiline = sub.multiline
	}

	if (type === 'headings') {
		if (sub.match               !== undefined) migrated.heading_match       = sub.match
		if (sub.value               !== undefined) migrated.heading_value       = sub.value
		if (sub.include_heading_line !== undefined) migrated.include_heading_line = sub.include_heading_line
		if (sub.include_subheadings !== undefined) migrated.include_subheadings = sub.include_subheadings
	}

	if (type === 'callouts') {
		if (sub.callout_type    !== undefined) migrated.callout_type    = sub.callout_type
		if (sub.extract         !== undefined) migrated.extract         = sub.extract
		if (sub.include_type_label !== undefined) migrated.include_type_label = sub.include_type_label
	}

	return migrated as unknown as AutoPropertyRule
}

// ── Module-level pure helpers ─────────────────────────────────────────────────

export function shouldRun(
	rule: AutoPropertyRule,
	trigger: Trigger | 'manual',
	frontmatter: Record<string, unknown>,
	file: TFile
): boolean {
	if (rule.enabled === false) return false

	const triggers = rule.trigger ?? []
	if (trigger !== 'manual' && !triggers.includes(trigger)) return false

	const keyExists = Object.prototype.hasOwnProperty.call(frontmatter, rule.key)
	if (!keyExists && !rule.autoadd) return false

	const whererun    = rule.whererun    ?? []
	const whereignore = rule.whereignore ?? []

	if (whererun.length > 0 && !whererun.some(f => pathInFolder(file.path, f))) return false
	if (whereignore.some(f => pathInFolder(file.path, f))) return false

	return true
}

export function lineMatchesRule(line: string, rule: ResolvedRule): boolean {
	const checkLine = rule.ignore_indentation ? line.trim() : line
	const haystack  = rule.case_sensitive ? checkLine  : checkLine.toLowerCase()
	const needle    = rule.case_sensitive ? rule.value : rule.value.toLowerCase()

	switch (rule.match) {
		case 'starting_with': return haystack.startsWith(needle)
		case 'ending_with':   return haystack.endsWith(needle)
		case 'containing':    return haystack.includes(needle)
		case 'regex':         return new RegExp(rule.value, rule.case_sensitive ? '' : 'i').test(checkLine)
	}
}

export function collectResults(
	matches: string[],
	pull: Pull | 'first' | 'all' | 'count'
): string | string[] | number | null {
	if (pull === 'count') return matches.length
	if (matches.length === 0) return null
	if (pull === 'first' || pull === 'text') return matches[0]
	return matches // 'all' | 'section'
}

export function transformString(value: string, rule: ResolvedRule, file: TFile): string {
	let v = value
	if (rule.type === 'lines' && rule.omit_match && rule.value) {
		if (rule.value === '![[') {
			// Strip ! only, keeping [[ so the result is a clickable link rather than an embed
			v = v.replace(/^!\[\[/, '[[').replace(/\|\d+(x\d+)?(?=\]|$)/i, '')
		} else {
			v = v.replace(rule.value, '')
		}
	}
	if (rule.trim_whitespace) v = v.trim()
	if (rule.strip_markdown)  v = stripMarkdown(v)
	if (rule.result_regex)    v = extractRegexResult(v, rule)
	if (rule.format)          v = applyFormat(v, rule, file)
	return v
}

export function extractRegexResult(value: string, rule: ResolvedRule): string {
	let regex: RegExp
	try {
		regex = new RegExp(rule.result_regex)
	} catch {
		return value
	}
	const match = value.match(regex)
	if (!match) return ''
	return match[1] ?? match[0]
}

export function applyFormat(result: string, rule: ResolvedRule, file: TFile): string {
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

export function stripMarkdown(text: string): string {
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

export function valuesEqual(a: unknown, b: string | string[] | number | null): boolean {
	if (a === b) return true
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((v, i) => v === b[i])
	}
	if (Array.isArray(a) || Array.isArray(b)) return false
	if (a !== null && b !== null) return String(a) === String(b)
	return false
}

export function formatDate(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0')
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
		`T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function pathInFolder(filePath: string, folder: string): boolean {
	const normalized = folder.replace(/\\/g, '/').replace(/\/$/, '')
	return filePath === normalized || filePath.startsWith(normalized + '/')
}
