# Auto-Properties Plugin — v2.0 Handoff Notes

## What this is
An Obsidian plugin that automatically updates note frontmatter properties based on
user-defined rules. Rules watch note content and fire on configurable triggers.
Currently pending review on the Obsidian community plugin registry.

Two files of interest: `main.ts` and `settings.ts`. A rewrite from v1.1.1 → v2.0.0
is in progress. The files in this repo are the v2 versions — do not reference v1 logic.

---

## Rule schema

### Core principle
Rules are flat JSON objects. Every property is optional except `key`. Unrecognised
properties are ignored. **Structure doesn't matter** — users may nest properties
however they like; the parser flattens everything before use (see Parsing below).

Only properties that differ from their defaults need to appear in the JSON. The GUI
should also omit default-valued properties from JSON output.

### Minimal valid rule
```json
{ "key": "my-property" }
```

### All available properties

| Property | Type | Default | Applies to |
|---|---|---|---|
| `key` | string | — | **All** (required) |
| `enabled` | boolean | `true` | All |
| `autoadd` | boolean | `false` | All |
| `no_overwrite` | boolean | `false` | All |
| `trigger` | Trigger[] | `[]` | All |
| `whererun` | string[] | `[]` | All |
| `whereignore` | string[] | `[]` | All |
| `type` | RuleType | `"lines"` | All |
| `pull` | Pull | `"first"` | All content types |
| `strip_markdown` | boolean | `false` | All |
| `trim_whitespace` | boolean | `false` | All |
| `format` | string | `""` | All |
| `case_sensitive` | boolean | `false` | lines, between, headings |
| `match` | MatchType | `"starting_with"` | lines |
| `value` | string | `""` | lines |
| `omit_match` | boolean | `false` | lines |
| `ignore_indentation` | boolean | `false` | lines |
| `pull_next` | boolean | `false` | lines |
| `start` | string | `""` | between |
| `end` | string | `""` (= start) | between |
| `inclusive` | boolean | `false` | between |
| `multiline` | boolean | `false` | between |
| `heading_match` | HeadingMatch | `"level"` | headings |
| `heading_value` | string\|number | `1` | headings |
| `include_heading_line` | boolean | `false` | headings |
| `include_subheadings` | boolean | `true` | headings |
| `callout_type` | string | `""` (any) | callouts |
| `extract` | CalloutExtract | `"body"` | callouts |
| `include_type_label` | boolean | `false` | callouts |
| `file_pull` | FilePull | `"name"` | file |

### Type values
```
RuleType:      "lines" | "between" | "headings" | "callouts" | "file"
Pull:          "first" | "all" | "count"
MatchType:     "starting_with" | "ending_with" | "containing" | "regex"
HeadingMatch:  "level" | "text"
CalloutExtract:"header" | "body" | "both"
FilePull:      "name" | "path" | "folder" | "extension" | "created" | "modified" | "size"
Trigger:       "modification" | "focus_change" | "open"
```

### Example rules (only non-default values shown)

**Pull all highlights:**
```json
{ "key": "highlights", "type": "between", "start": "==", "pull": "all" }
```

**First open task:**
```json
{ "key": "next-task", "value": "- [ ]", "omit_match": true, "trim_whitespace": true }
```

**File creation date:**
```json
{ "key": "created", "type": "file", "file_pull": "created", "no_overwrite": true }
```

**Link to a URL using a pulled value:**
```json
{ "key": "link", "value": "slug: ", "omit_match": true, "format": "https://example.com/${result}" }
```

**First H1 text:**
```json
{ "key": "title", "type": "headings", "pull": "text" }
```

**Summary section content:**
```json
{
  "key": "summary",
  "type": "headings",
  "heading_match": "text",
  "heading_value": "Summary",
  "include_subheadings": false,
  "strip_markdown": true,
  "trim_whitespace": true
}
```

**Users may also freely nest for their own organisation — all equivalent:**
```json
{
  "key": "highlights",
  "input": { "type": "between", "start": "==" },
  "output": { "pull": "all" }
}
```

---

## Parsing: recursive key flattening

The parser walks the rule object recursively, collecting known keys at any depth.
Unknown keys that are objects are recursed into (enabling user-defined grouping).
Unknown scalar keys are silently ignored.

```typescript
const KNOWN_KEYS = new Set([
  'key', 'enabled', 'autoadd', 'no_overwrite', 'trigger', 'whererun', 'whereignore',
  'type', 'pull', 'strip_markdown', 'trim_whitespace', 'format', 'case_sensitive',
  'match', 'value', 'omit_match', 'ignore_indentation', 'pull_next',
  'start', 'end', 'inclusive', 'multiline',
  'heading_match', 'heading_value', 'include_heading_line', 'include_subheadings',
  'callout_type', 'extract', 'include_type_label',
  'file_pull'
])

function flattenRule(obj: unknown, collected: Record<string, unknown> = {}): Record<string, unknown> {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return collected
  for (const [k, v] of Object.entries(obj)) {
    if (KNOWN_KEYS.has(k)) {
      collected[k] = v
    } else if (typeof v === 'object' && !Array.isArray(v)) {
      flattenRule(v, collected)
    }
  }
  return collected
}
```

After flattening, apply defaults for any missing keys before use.

---

## Architecture overview

### Execution pipeline (main.ts)
```
trigger fires
  → update(file, trigger)
    → read file, extractBodyLines()
    → processFrontMatter() [single atomic write]
      → filter rules via shouldRun()
      → per rule: flattenRule() → applyDefaults() → evaluateRule()
          → file type:          evaluateFileRule()
          → all content types:  toBoundaryConditions() → extractBetweenBoundaries()
      → applyOutputTransforms() [trim, strip_markdown, format]
      → write changed values, skip if unchanged
      → track written keys — first non-empty result wins per key
    → Notice if changes > 0
```

### Key design decisions (don't relitigate)
- **Flat schema, recursive parser** — structure is user's choice. Parser normalises
  before use. See above.
- **Everything optional except `key`** — defaults cover all omitted fields.
- **`between` as the core primitive** — Lines, Headings, Callouts all translate to
  boundary conditions via `toBoundaryConditions()` and run through
  `extractBetweenBoundaries()`. Intentional. Don't refactor.
- **No dependencies** — zero npm dependencies beyond Obsidian's API. Keep it that way.
- **`isWriting` flag** — prevents re-entrant modify events. Set before
  `processFrontMatter`, cleared in `finally`. Do not remove.
- **`format` template** — `${result}`, `${filename}`, `${folder}`, `${path}`,
  `${created}`, `${modified}`. Unknown placeholders pass through unchanged.
- **First non-empty wins per key** — if multiple rules target the same key, the
  first one (in list order) that produces a non-empty value wins. Track with a
  `Set<string>` of already-written keys inside `processFrontMatter`.
- **No `on save` trigger** — Obsidian has no clean native save event. Removed.
  Users can assign a hotkey to the manual command.
- **Naming** — avoid "basis" (collides with Obsidian Bases), avoid "template"
  (collides with Obsidian Templates). Use "type" and "format".

---

## Open tasks

### Must-do before v2.0.0

1. **Rewrite TypeScript types** to match new flat schema. Replace the discriminated
   union with a single `AutoPropertyRule` interface where everything except `key`
   is optional. Add `ResolvedRule` as the post-defaults, post-flatten shape used
   internally during evaluation.

2. **Implement `flattenRule()` and `applyDefaults()`** in main.ts. These run at
   the start of `evaluateRule()` before any type switching.

3. **`omit_match`** — after a Lines rule matches, strip the first occurrence of
   `value` from the result string.
   Example: value `"- [ ]"`, line `"- [ ] Buy milk"` → `"Buy milk"`.

4. **`ignore_indentation`** — trim the line *before the match check only*.
   Does not affect the returned value. Separate from `trim_whitespace`.

5. **`whererun` / `whereignore` logic** in `shouldRun()`:
   - If `whererun` non-empty, file path must match one of those folders
   - Subtract: if file matches any `whereignore` folder, skip
   - `whereignore` wins if both match

6. **Update settings GUI** to reflect flat schema. The `rule: { ... }` sub-object
   is gone. All fields live at the top level of the rule. `buildXxxFields()`
   functions need updating accordingly. JSON output should omit default-valued
   fields.

7. **Ruleset import/export** — dedicated section at top of settings tab:
   - Export: `JSON.stringify` of `settings.rules` (non-default fields only)
     copied to clipboard
   - Import: textarea, "Replace all" and "Append" buttons, validate before commit

8. **Jest test suite** — no tests exist. All evaluation logic is pure functions,
   straightforward to test. Priority:
   - `flattenRule` (various nesting structures)
   - `applyDefaults`
   - `extractBetweenBoundaries` (all 4 type cases)
   - `evaluateRule` (one per type)
   - `stripMarkdown`
   - `applyFormat`
   - `shouldRun`
   - `valuesEqual`

### v2.1 candidates
- `${this.someKey}` in format — reference other frontmatter properties.
  Constraint: only non-auto-properties-managed keys (avoids circular deps).
- Date format modifier on file rules — `date_format: 'iso' | 'unix' | 'locale'`
- Block ID → link conversion (was in v1, not yet ported)
- Embed → link conversion (was in v1, not yet ported)

---

## Settings GUI notes
- Each rule = collapsible panel (`property-panel` CSS class)
- GUI mode and JSON mode toggled by button *inside* the panel (hidden when collapsed)
- GUI → JSON: serialise current in-memory state, **omitting default-valued fields**
- JSON → GUI: flatten → apply defaults → rebuild GUI via `rebuildGuiView()`
- Rule type switching preserves per-type field values in a `ruleCache` map until Save
- `makeSummaryText()` generates one-line collapsed summary per rule type
- `buildXxxFields()` — module-level functions, one per rule type

## File structure
```
main.ts          — plugin entrypoint, all execution logic
settings.ts      — types, interfaces, settings tab GUI
styles.css       — CSS used by settings GUI
manifest.json    — Obsidian plugin manifest
```

## Gotchas
- `processFrontMatter` is atomic — all rule evaluation and writes must happen
  inside a single call per `update()`. Do not read frontmatter separately first.
- `modify` vault event fires for ALL vault files, not just the active one.
  The handler already filters to active file only — don't remove that check.
- `isWriting` must be cleared in a `finally` block — already done, don't change.
