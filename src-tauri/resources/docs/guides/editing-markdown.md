# editing markdown

flowrite is a rich markdown editor that supports all standard markdown formatting along with some extra features like slash commands and autoformat shortcuts.

## text formatting

select text and use the floating toolbar, or use keyboard shortcuts:

| format            | shortcut | markdown syntax |
| ----------------- | -------- | --------------- |
| **bold**          | `⌘B`     | `**text**`      |
| _italic_          | `⌘I`     | `*text*`        |
| underline         | `⌘U`     | —               |
| ~~strikethrough~~ | `⌘⇧M`    | `~~text~~`      |
| `inline code`     | `⌘E`     | `` `text` ``    |
| link              | `⌘K`     | `[text](url)`   |

## headings

type `#` at the start of a line for a heading. use `##` through `######` for different levels. you can also use `⌘⌥1` through `⌘⌥6` to convert any block to a heading.

## lists

* type `-` or `*` to start a bullet list
* type `1.` to start a numbered list
* press `Tab` to indent a list item, `Shift+Tab` to outdent
* lists can be nested to multiple levels

## todo lists

type `[]` at the start of a line to create a todo item with a checkbox. toggle the checkbox with `⌘⌥X`.

## code blocks

type ` ``` ` to create a code block, or press `⌘⌥8`. code blocks support syntax highlighting — specify the language after the opening backticks (e.g., ` ```javascript `).

## blockquotes

type `>` at the start of a line to create a blockquote.

## tables

use the slash command menu (type `/`) and select "table" to insert a table. you can add and remove rows and columns using the table controls that appear when your cursor is inside a table.

## toggle blocks

toggle blocks are collapsible sections. insert one from the slash command menu (`/`).

## horizontal rules

type `---` on a new line to insert a horizontal rule.

## emojis

type `:` followed by an emoji name to search and insert emojis, or use the emoji picker from the slash command menu.

## dates

insert the current date from the slash command menu (`/`).

## autoformat

flowrite automatically converts markdown syntax as you type. for example:

* type `**text**` and it becomes **bold**
* type `*text*` and it becomes _italic_
* type `#` and it becomes a heading
* type `-` and it becomes a list
* type `>` and it becomes a blockquote
* type ` ``` ` and it becomes a code block

## slash commands

type `/` anywhere in the editor to open the slash command menu. this gives you quick access to insert any block type — headings, code blocks, tables, todos, toggles, dates, emojis, and more.

## floating toolbar

select any text to see a floating toolbar with formatting options. this is a quick way to apply bold, italic, underline, strikethrough, code, links, and comments without memorizing shortcuts.

## block navigation

move between blocks efficiently with these shortcuts:

| action              | shortcut |
| ------------------- | -------- |
| next block          | `⌘⌥J`    |
| previous block      | `⌘⌥K`    |
| next section        | `⌘⌥L`    |
| previous section    | `⌘⌥H`    |
| insert block after  | `⌘↩`     |
| insert block before | `⌘⇧↩`    |

## see also

* [keyboard shortcuts](../reference/keyboard-shortcuts.md) — complete shortcut reference
* [managing files](./managing-files.md) — creating and organizing your markdown files
* [comments & collaboration](./comments-and-collaboration.md) — adding comments to your documents
