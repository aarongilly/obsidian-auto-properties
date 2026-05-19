# Auto-Properties Plugin — v2.0 Handoff Notes

## What this is
An Obsidian plugin that automatically updates note frontmatter properties based on
user-defined rules. Rules watch note content and fire on configurable triggers.
Currently pending review on the Obsidian community plugin registry.

The codebase has two files of interest: `main.ts` and `settings.ts`.
A rewrite from v1.1.1 → v2.0.0 is in progress. The new versions of both files
are the ones in this repo — do not reference the v1 logic.

---

## Architecture overview

### Rule schema
Every rule is an `AutoPropertyRule` — a flat object with common top-level fields
plus a discriminated union on `type`:

```
type AutoPropertyRule = {
  key, enabled, autoadd, no_overwrite,
  trigger: Trigger[],
  whererun: string[], whereignore: string[],
  strip_markdown, trim_whitespace, case_sensitive,
  format: string   // template string, e.g. "https://example.com/${result}"
} & RuleType
```

Five rule types: `file` | `lines` | `between` | `headings` | `callouts`

Each type has its own `rule: XxxRule` object shape. See `settings.ts` for the
full interfaces.

### Execution pipeline (main.ts)
```
trigger fires
  → update(file, trigger)
    → read file, extractBodyLines()
    → processFrontMatter() [single atomic write]
      → filter rules via shouldRun()
      → evaluateRule() per rule
          → file type: evaluateFileRule()
          → all others: toBoundaryConditions() → extractBetweenBoundaries()
      → applyOutputTransforms() [trim, strip_markdown, format template]
      → write changed values to frontmatter
    → show Notice if changes > 0
```

### Key design decisions (don't relitigate these)
- **Flat rule schema** — no nested "modifiers" or "features" arrays. Everything
  is a named key.
- **`type` not `basis`** — the discriminator field is called `type`.
- **`between` as the core primitive** — Lines, Headings, Callouts all translate
  to boundary conditions and run through `extractBetweenBoundaries()`. This is
  intentional. Don't refactor it.
- **No dependencies** — zero npm dependencies beyond Obsidian's own API. Keep it
  that way.
- **`isWriting` flag** — prevents re-entrant modify events from our own
  frontmatter writes. Set before `processFrontMatter`, cleared in `finally`.
- **`format` template** — supports `${result}`, `${filename}`, `${folder}`,
  `${path}`, `${created}`, `${modified}`. Unknown placeholders pass through
  unchanged (intentional — visible and debuggable).
- **Naming** — avoid "basis" (collides with Obsidian Bases feature), avoid
  "template" (collides with Obsidian Templates). Use "type" and "format".
- **`on save` trigger removed** — Obsidian has no clean native save event.
  Not worth the complexity. Users can assign a hotkey to the manual command.

---

## Known open tasks

### Must-do before v2.0.0 release

1. **`omit_match` on LinesRule** — v1 had "omit search string from result".
   Needs to be added back. Field: `omit_match: boolean` on `LinesRule`.
   After a line matches, strip the first occurrence of `rule.value` from the
   result string before returning.
   Example: rule value `"- [ ]"`, line `"- [ ] Buy milk"` → result `"Buy milk"`.

2. **`ignore_indentation` on LinesRule** — v1 trimmed before matching.
   In v2, `trim_whitespace` is output-only. Need a separate
   `ignore_indentation: boolean` that trims the line *before the match check*
   but does not affect the returned value. These are different operations and
   must stay separate.

3. **Settings GUI needs updating** for the two fields above — add them to
   `buildLinesFields()` in `settings.ts`.

4. **Jest test suite** — no tests exist yet. All static methods on
   `AutoPropertyPlugin` are pure functions and should be straightforward to test.
   Priority order:
   - `extractBetweenBoundaries` (all 4 type cases)
   - `evaluateRule` (one test per rule type)
   - `stripMarkdown`
   - `applyFormat` / `applyOutputTransforms`
   - `shouldRun`
   - `valuesEqual`
   
   A minimal `TFile` mock is needed for file-dependent tests. There is a standard
   Jest config that works for Obsidian plugins — find and use it.

5. **Ruleset import/export** — users need to be able to share/backup their full
   ruleset as JSON. Should live as a dedicated section at the top of the settings
   tab (above individual rule panels). Requirements:
   - Export: copy full `settings.rules` array as formatted JSON to clipboard
   - Import: textarea for paste-in, with "Replace all" and "Append" buttons
   - Validate JSON before committing (use `tryParseRuleJson` pattern already in
     settings.ts, extended to validate an array)
   - Show clear error if JSON is invalid

6. **Multiple rules targeting the same key** — currently untested behaviour.
   Decided approach: **first non-empty wins** within a single `update()` call.
   Implement by tracking a `Set<string>` of keys already written in the current
   `processFrontMatter` pass, and skipping subsequent rules for that key.

7. **`whererun` / `whereignore` logic** — currently not implemented in
   `shouldRun()`. Logic should be:
   - If `whererun` is non-empty, file path must start with one of those folders
   - Then subtract: if file path starts with any `whereignore` folder, skip
   - `whereignore` wins over `whererun` if both match

### Nice-to-have / v2.1 candidates

- **`${this.someKey}` in format templates** — lets users reference other
  frontmatter properties in the format string. Constraint for v2.1: can only
  reference properties *not* managed by auto-properties (avoids circular
  dependency resolution). Medium complexity.
- **Date format modifier on File rules** — `date_format: 'iso' | 'unix' | 'locale'`
  for `created` and `modified` pulls. Currently always outputs ISO.
- **Block ID → link conversion** — v1 detected block IDs (`^blockid`) in matched
  lines and converted them to `[[#^blockid|text]]` links. Not yet ported to v2.
- **Embed → link conversion** — v1 stripped the `!` from embedded image matches
  so `![[image.png]]` became `[[image.png]]` in the property value. Not yet
  ported.

---

## Settings GUI notes

- Each rule renders as a collapsible panel (`property-panel` CSS class)
- Panel has two modes: GUI and JSON, toggled by a button inside the panel
  (not in the header — header is always visible when collapsed)
- GUI → JSON: serializes current in-memory state into textarea
- JSON → GUI: parses and validates, then rebuilds GUI view via `rebuildGuiView()`
- Rule type switching preserves per-type rule data in a `ruleCache` map until Save
- `makeSummaryText()` generates the one-line collapsed summary per rule type
- `buildXxxFields()` functions are module-level (not class methods) — one per
  rule type

---

## File structure
```
main.ts          — plugin entrypoint, all execution logic
settings.ts      — types, interfaces, settings tab GUI
styles.css       — CSS classes used by settings GUI
manifest.json    — Obsidian plugin manifest
```

---

## Things to be careful about

- `processFrontMatter` is Obsidian's atomic read-modify-write for frontmatter.
  All rule evaluation and all writes must happen inside a single call per
  `update()` invocation. Do not read frontmatter separately before calling it.
- The `modify` vault event fires for *all* files, not just the active one.
  The handler already filters to active file only — don't remove that check.
- `isWriting` must be cleared in a `finally` block — already done, don't change.
- TypeScript will complain about the `(wip as any) = { ...wip, ...defaults }`
  pattern in the rule type switcher in settings.ts. This is intentional and
  known — discriminated union reassignment limitation. Leave it.
