# Auto-Properties Wiki

Auto-Properties is an Obsidian plugin that automatically fills note frontmatter properties using configurable rules. Rules watch your note's body content (or file metadata) and write values to properties — your note body is **never modified**, only frontmatter.

---

## Table of Contents

- [Core Concepts](#core-concepts)
- [Rule Fields Reference](#rule-fields-reference)
- [Rule Types](#rule-types)
  - [Lines](#lines)
  - [Between](#between)
  - [Headings](#headings)
  - [Callouts](#callouts)
  - [File](#file)
- [Triggers](#triggers)
- [Behaviors](#behaviors)
- [Output & Filters](#output--filters)
- [Scope](#scope)
- [Commands](#commands)
- [Import / Export](#import--export)
- [Example Use Cases](#example-use-cases)

---

## Core Concepts

A **rule** maps a pattern in your note (or a file attribute) to a **frontmatter property key**. When its trigger fires, the plugin reads the note body, applies the rule's logic, and writes the result to the specified property.

- If the rule finds nothing, any existing value for that key is cleared (set to null).
- The first rule that produces a non-empty value for a given key wins — later rules for the same key are skipped.
- Rules run in order. You can reorder them in settings.

---

## Rule Fields Reference

These fields are shared across all rule types. Only `key` is required — everything else has a sensible default.

| Field | Type | Default | Description |
|---|---|---|---|
| `key` | string | *(required)* | The frontmatter property key to write to |
| `type` | string | `"lines"` | Rule type: `lines`, `between`, `headings`, `callouts`, or `file` |
| `enabled` | boolean | `true` | Disable a rule without deleting it |
| `autoadd` | boolean | `false` | Create the property in frontmatter if it doesn't already exist |
| `no_overwrite` | boolean | `false` | Skip the rule if the property already has a non-empty value |
| `trigger` | array | `[]` | When the rule fires: `"modification"`, `"open"`, `"focus_change"` |
| `whererun` | array | `[]` | Only run in these folders (folder paths, one per entry) |
| `whereignore` | array | `[]` | Skip notes in these folders |
| `strip_markdown` | boolean | `false` | Remove markdown formatting from the result before writing |
| `trim_whitespace` | boolean | `false` | Strip leading and trailing whitespace from the result |
| `result_regex` | string | `""` | Replace the result with the first regex match, or the first capture group if present |
| `format` | string | `""` | Template string wrapping the result (e.g. `"https://example.com/${result}"`) |
| `pull` | string | `"first"` | How many matches to collect: `"first"`, `"all"`, or `"count"` |
| `case_sensitive` | boolean | `false` | Case-sensitive matching |

---

## Rule Types

### Lines

Finds lines in the note body that match a pattern and pulls content from them.

**Type value:** `"lines"`

| Field | Type | Default | Description |
|---|---|---|---|
| `match` | string | `"starting_with"` | How to match lines: `"starting_with"`, `"ending_with"`, `"containing"`, or `"regex"` |
| `value` | string | `""` | The string or regex pattern to match against |
| `pull` | string | `"first"` | `"first"` (first match), `"all"` (list of all matches), or `"count"` (number of matches) |
| `omit_match` | boolean | `true` | Remove the matched search string from the result |
| `pull_next` | boolean | `false` | Instead of the matched line, pull the line immediately after it |
| `ignore_indentation` | boolean | `false` | Strip leading whitespace before matching (useful for nested list items) |

**Notes on `match` modes:**
- `starting_with` — line begins with `value` (after optional indentation if `ignore_indentation` is true)
- `ending_with` — line ends with `value`
- `containing` — line contains `value` anywhere
- `regex` — treats `value` as a regular expression; `case_sensitive` controls the `i` flag

**Notes on `omit_match`:**
- For most patterns, the matched string is stripped from the result.
- Special case: if `value` is `"![["`, the `!` is stripped but `[[` is kept, turning the embed into a clickable wikilink. Size aliases like `|500` are also removed.

---

### Between

Finds content that appears between two delimiter strings.

**Type value:** `"between"`

| Field | Type | Default | Description |
|---|---|---|---|
| `start` | string | `""` | Opening delimiter |
| `end` | string | `""` | Closing delimiter. Defaults to `start` if omitted (same open/close delimiter) |
| `pull` | string | `"first"` | `"first"`, `"all"`, or `"count"` |
| `inclusive` | boolean | `false` | Include the delimiters themselves in the result |
| `multiline` | boolean | `false` | Match spans that cross line boundaries |

**Notes:**
- When `start` is `"![["` and `inclusive` is true, the result has the `!` stripped (embed → link). Size aliases like `|500` are also removed.
- Without `multiline`, each line is scanned independently for delimiter pairs.
- With `multiline`, the entire note body is searched as one string — useful for fenced code blocks, multi-line callout bodies, etc.

---

### Headings

Pulls content from under a heading, targeted by level or exact text.

**Type value:** `"headings"`

| Field | Type | Default | Description |
|---|---|---|---|
| `heading_match` | string | `"level"` | How to find the heading: `"level"` (by `#` depth) or `"text"` (by heading text) |
| `heading_value` | number or string | `1` | The level (1–6) or the heading text to match |
| `pull` | string | `"first"` | `"text"` (heading text only), `"first"` (full section content), or `"count"` (number of matching headings) |
| `include_heading_line` | boolean | `false` | Include the `## Heading` line itself in the section result |
| `include_subheadings` | boolean | `false` | Include content under nested sub-headings in the section result |

**Notes on `pull` values for headings:**
- `"text"` — returns the heading text (with `#` markers stripped), not the section content beneath it
- `"first"` — returns the full content of the section under the first matching heading
- `"all"` — returns the content of all matching sections as a list
- `"count"` — returns the number of matching headings as a number

When `pull` is `"first"` or `"all"` (section mode), the section ends when the next heading of the same or higher level is encountered. `include_subheadings` controls whether lines under deeper headings are included.

---

### Callouts

Pulls content from Obsidian callout blocks.

**Type value:** `"callouts"`

| Field | Type | Default | Description |
|---|---|---|---|
| `callout_type` | string | `""` | Filter by callout type (e.g. `"tip"`, `"warning"`, `"tldr"`). Empty = match all types |
| `extract` | string | `"body"` | What to extract: `"header"`, `"body"`, or `"both"` |
| `include_type_label` | boolean | `false` | Include the full `> [!type]` header line in the result instead of just the title text |
| `pull` | string | `"first"` | `"first"`, `"all"`, or `"count"` |

**Callout anatomy:**
```
> [!note] This is the header title
> This is the body
> It can span multiple lines
```

- `"header"` extracts `"This is the header title"` (or the full `> [!note] This is the header title` line if `include_type_label` is true)
- `"body"` extracts `"This is the body\nIt can span multiple lines"`
- `"both"` extracts both, joined together

---

### File

Pulls metadata from the file itself rather than its content.

**Type value:** `"file"`

| Field | Type | Default | Description |
|---|---|---|---|
| `file_pull` | string | `"name"` | What to pull: `"name"`, `"path"`, `"folder"`, `"extension"`, `"created"`, `"modified"`, or `"size"` |

| `file_pull` value | Result |
|---|---|
| `"name"` | The file's base name without extension (e.g. `My Note`) |
| `"path"` | Full vault-relative path (e.g. `Projects/My Note.md`) |
| `"folder"` | The parent folder path (e.g. `Projects`) |
| `"extension"` | File extension without dot (e.g. `md`) |
| `"created"` | Creation timestamp in `YYYY-MM-DDTHH:MM:SS` format |
| `"modified"` | Last-modified timestamp in `YYYY-MM-DDTHH:MM:SS` format |
| `"size"` | File size in bytes (number) |

The `format` field can compose these into richer strings. For example, `${result}` refers to the pulled value, while `${filename}`, `${folder}`, `${path}`, `${created}`, and `${modified}` are always available regardless of type.

---

## Triggers

Each rule has an independent list of triggers that control when it fires. Rules with no triggers enabled only run via the command palette.

| Trigger | JSON value | When it fires |
|---|---|---|
| Modify | `"modification"` | Shortly after the note content changes (only fires for the currently active file) |
| Open | `"open"` | Once when a note is opened in the editor |
| Focus | `"focus_change"` | When you navigate *away* from a note (i.e., the previously active file is updated) |

Multiple triggers can be active at once — add them as an array:

```json
"trigger": ["modification", "open"]
```

**Choosing the right trigger:**
- Use **Modify** for properties that should always reflect the current note content (e.g. task counts, image links).
- Use **Open** for one-time initialization that doesn't need to update constantly.
- Use **Focus** for properties that should be stamped when you leave the note (e.g. a `modified` date that only updates when you're done editing).

---

## Behaviors

| Field | JSON key | Description |
|---|---|---|
| Enabled | `"enabled"` | Set to `false` to disable a rule without deleting it. Rules default to enabled. |
| Auto-add | `"autoadd"` | When `true`, the rule creates the frontmatter property if it doesn't already exist. When `false`, the rule only fires if the property key is already present in frontmatter. |
| No overwrite | `"no_overwrite"` | When `true`, the rule skips writing if the property already has a non-empty value. Useful for set-once properties like creation metadata. |

---

## Output & Filters

These fields shape the final value before it's written to frontmatter.

### `pull`

Controls how many matches are collected:

| Value | Result type | Description |
|---|---|---|
| `"first"` | string | Only the first match |
| `"all"` | array of strings | All matches, written as a YAML list |
| `"count"` | number | The total count of matches |

### `strip_markdown`

When `true`, removes common markdown formatting from the result:

- `**bold**` → `bold`
- `*italic*` → `italic`
- `` `code` `` → `code`
- `~~strikethrough~~` → `strikethrough`
- `[[Link|Alias]]` → `Alias`
- `[[Link]]` → `Link`
- `[Label](url)` → `Label`
- Heading markers (`## `), list bullets (`- `), and blockquote markers (`> `) are also stripped.

### `trim_whitespace`

When `true`, strips leading and trailing whitespace from each result string.

### `result_regex`

When set, runs a regular expression against each result string before `format` is applied. The result becomes the first capture group if the pattern has one, otherwise the full first match. If the pattern does not match, the result becomes empty.

Example: `"result_regex": "\\[([^\\]]+)\\]"` would turn a file name like `[Value] - Some More Text` into `Value`, so a `format` value like `"https://example.com/${result}"` becomes `https://example.com/Value`.

### `format`

A template string that wraps the result. Available placeholders:

| Placeholder | Value |
|---|---|
| `${result}` | The extracted value |
| `${filename}` | File base name (no extension) |
| `${folder}` | Parent folder path |
| `${path}` | Full vault-relative file path |
| `${created}` | File creation timestamp |
| `${modified}` | File modification timestamp |

Example: `"format": "https://example.com/notes/${result}"` would turn a result of `my-note` into `https://example.com/notes/my-note`.

---

## Scope

Each rule can be restricted to certain folders to avoid running on notes where it doesn't apply.

| Field | JSON key | Description |
|---|---|---|
| Run in folders | `"whererun"` | Array of folder paths. Rule only processes notes inside these folders. |
| Ignore folders | `"whereignore"` | Array of folder paths. Rule skips notes inside these folders. |

- Paths match on prefix — `"Projects"` matches `Projects/My Note.md` and `Projects/Sub/Note.md`.
- `whereignore` wins if both conditions are satisfied.
- Leave both empty (the default) to run on all notes in the vault.

```json
"whererun": ["Work/Projects", "Personal/Goals"],
"whereignore": ["Work/Archive"]
```

---

## Commands

Two commands are available via the command palette (`Cmd/Ctrl+P`):

| Command | Description |
|---|---|
| **Auto-Properties: Update auto-properties** | Runs all triggered rules against the currently active note |
| **Auto-Properties: Update auto-properties for every note in vault** | Runs all triggered rules across every markdown file in the vault |

Both commands behave as a "manual" trigger — they bypass the trigger filter and run every enabled rule (that passes scope checks).

---

## Import / Export

Rules are stored as JSON and can be exported/imported from the plugin settings page.

**Export:** Click "Export to clipboard" — all current rules are copied as a JSON array.

**Import:** Paste a JSON array into the import box, then either:
- **Append to existing** — adds the imported rules after your current ones
- **Replace all** — discards all current rules and replaces them with the imported set

This makes it easy to share rule sets between vaults or with other users.

---

## Example Use Cases

Each example below includes copy-pastable JSON. Import them via Settings → Auto-Properties → Import rules.

---

### 1. Track the last-modified date

Stamps a `modified` property every time you navigate away from a note.

```json
[
  {
    "key": "modified",
    "autoadd": true,
    "trigger": ["focus_change"],
    "type": "file",
    "file_pull": "modified"
  }
]
```

---

### 2. Count open tasks

Counts unchecked checklist items. Works in indented lists too.

```json
[
  {
    "key": "open_tasks",
    "autoadd": true,
    "trigger": ["modification", "open"],
    "value": "- [ ]",
    "pull": "count",
    "ignore_indentation": true
  }
]
```

---

### 3. Pull a TL;DR summary from a callout

Reads the body of any `> [!tldr]` callout and stores it as a plain-text summary (markdown stripped).

```json
[
  {
    "key": "summary",
    "autoadd": true,
    "trigger": ["modification", "focus_change"],
    "type": "callouts",
    "callout_type": "tldr",
    "extract": "body",
    "strip_markdown": true
  }
]
```

Usage in your note:
```
> [!tldr] 
> This note covers the quarterly planning process and key decisions made in Q3.
```

---

### 4. Collect all highlights

Pulls every `==highlighted==` phrase into a list property.

```json
[
  {
    "key": "highlights",
    "autoadd": true,
    "trigger": ["modification"],
    "type": "between",
    "start": "==",
    "pull": "all"
  }
]
```

---

### 5. Extract all embedded images as links

Finds every `![[image.png]]` embed and stores them as wikilinks (stripping the `!` so they don't embed).

```json
[
  {
    "key": "images",
    "autoadd": true,
    "trigger": ["modification"],
    "value": "![["
  }
]
```

Note: `omit_match` defaults to `true`. For `![[`, only the `!` is stripped — `[[` is kept, so the result is a clickable `[[image.png]]` link.

---

### 6. Pull a section's content into a property

Reads everything under the `## Summary` heading into a `section_summary` property.

```json
[
  {
    "key": "section_summary",
    "autoadd": true,
    "trigger": ["focus_change"],
    "type": "headings",
    "heading_match": "text",
    "heading_value": "Summary",
    "pull": "first",
    "strip_markdown": true
  }
]
```

---

### 7. Stamp the file name as a title (once)

Sets a `title` property to the file name when the note is first opened. Won't overwrite if you've already set it manually.

```json
[
  {
    "key": "title",
    "autoadd": true,
    "no_overwrite": true,
    "trigger": ["open"],
    "type": "file",
    "file_pull": "name"
  }
]
```

---

### 8. Collect all wikilinks

Pulls every `[[wikilink]]` in the note into a list. Useful for building a manual "related notes" property.

```json
[
  {
    "key": "related",
    "autoadd": true,
    "trigger": ["modification"],
    "type": "between",
    "start": "[[",
    "end": "]]",
    "pull": "all"
  }
]
```

---

### 9. Count headings in a note

Counts every H2 heading — useful for notes that act as indexes or tables of contents.

```json
[
  {
    "key": "section_count",
    "autoadd": true,
    "trigger": ["modification"],
    "type": "headings",
    "heading_match": "level",
    "heading_value": 2,
    "pull": "count"
  }
]
```

---

### 10. Folder-scoped status tag

Reads the first line starting with `Status:` in your `Work/` notes only, and stores the value (with the prefix stripped).

```json
[
  {
    "key": "status",
    "autoadd": true,
    "trigger": ["modification", "open"],
    "whererun": ["Work"],
    "value": "Status:",
    "pull": "first",
    "trim_whitespace": true
  }
]
```

---

### 11. Extract a YAML-style inline value

Pulls the value after `Author: ` anywhere in the note body. Useful if you write structured text before adding frontmatter.

```json
[
  {
    "key": "author",
    "autoadd": true,
    "trigger": ["modification"],
    "value": "Author: ",
    "match": "starting_with",
    "pull": "first",
    "trim_whitespace": true
  }
]
```

---

### 12. All rules from the README example

The five-rule set shown in the README — a practical starting point:

```json
[
  {
    "key": "overview",
    "autoadd": true,
    "strip_markdown": true,
    "type": "callouts",
    "callout_type": "tldr"
  },
  {
    "key": "modified",
    "autoadd": true,
    "trigger": ["focus_change"],
    "type": "file",
    "file_pull": "modified"
  },
  {
    "key": "task_count",
    "autoadd": true,
    "value": "- [ ]",
    "pull": "count",
    "ignore_indentation": true
  },
  {
    "key": "highlights",
    "autoadd": true,
    "type": "between",
    "pull": "all",
    "start": "=="
  },
  {
    "key": "img",
    "autoadd": true,
    "value": "![["
  }
]
```
