# managing files

flowrite organizes your markdown files in the `~/flowrite` directory. the file tree on the left side of the workspace lets you browse, search, and manage all your files.

## file tree

the file tree panel shows all markdown files and folders in your workspace. toggle it with `⌘⇧E`.

* click a file to open it in the editor
* click a folder to expand or collapse it
* right-click a file or folder for a context menu with additional options
* use the search bar at the top of the file tree to filter files by name

### expanding and collapsing

use the controls at the top of the file tree to expand or collapse all folders at once, which is helpful when navigating large workspaces.

## creating files and folders

* press `⌘N` to create a new file
* right-click in the file tree to create a new file or folder
* new files are created as markdown (`.md`) files by default

## renaming and deleting

right-click a file or folder in the file tree to rename or delete it. deleted files are moved to the system trash, so you can recover them if needed.

## organizing with drag and drop

drag files and folders in the file tree to move them into different folders. this lets you reorganize your workspace without leaving the editor.

## where files are stored

all your files live in the `~/flowrite` directory on your local machine. nothing is uploaded to the cloud. you can access this folder directly from Finder or the terminal if you need to.

## opening external files

you can open markdown files from outside the `~/flowrite` directory:

* **from the menu** — use `⌘O` to open a file dialog and select any `.md` file on your system
* **from the command palette** — press `⌘P` and type an absolute path (starting with `/` or `~`) to open a file from anywhere on your system
* **from Finder** — double-click any `.md` file in Finder and it will open in flowrite (flowrite is registered as a handler for markdown files)

external files open in the editor just like workspace files, but they remain at their original location on disk.

## saving

* press `⌘S` to save the current file
* press `⌘⇧S` to save all open files
* if you try to close a tab with unsaved changes, flowrite will ask if you want to save first

## see also

* [workspace & layout](./workspace-and-layout.md) — managing tabs, panels, and views
* [editing markdown](./editing-markdown.md) — formatting and editing features
* [versioning & metadata](../reference/versioning-and-metadata.md) — how file versioning and metadata work
