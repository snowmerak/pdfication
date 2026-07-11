# pdfication 🗰

`pdfication` is a premium, high-performance desktop PDF utility and viewing application. Built using a modern desktop hybrid stack with **Wails (Go)** on the backend, **Vanilla TypeScript (Vite)** on the frontend, and **PDF.js** as the core page rendering engine, it provides a comprehensive workspace resembling professional tools like PDF24.

---

## 🎨 Design Philosophy & Aesthetics

- **Rich Glassmorphic Theme**: Dark mode styled using carefully curated HSL colors, smooth linear gradients, glowing indicators (`var(--accent-glow)`), and hover-activated card elevations.
- **Unified Workspace Layout**: The start/welcome screen and the utility dashboard are merged into a permanent, static **Toolbox** tab inside the main tabbed interface.
- **60fps Smooth Scroll Rendering**: Scroll layouts use an asynchronous `IntersectionObserver` to calculate boundaries and lazily draw viewport page canvases, avoiding browser main-thread layout thrashing.
- **Fluid Desktop Interactions**: Includes a native-feeling marquee selection (lasso select) tool, keyboard shortcuts, and smooth slide animations.

---

## 🚀 Key Features

### 1. Tabbed Document Workspace
- **Multi-Tab Layout**: Open multiple PDFs simultaneously, each maintaining its own viewport, zoom level, search query, and action history.
- **Permanent Toolbox Dashboard**: A static dashboard tab that acts as the home dashboard. Access all conversion and protection tools before loading files.
- **Drag & Drop Dropzone**: Drag files directly onto the workspace to launch the reader.
- **Recent Files List**: Stores recent PDF paths and timestamps locally with inline removal buttons.

### 2. PDF Reader Mode
- **Flexible Zoom Input**: Interactive text input supporting preset dropdown options (50% – 300%), custom percentage numbers (e.g. `120%`), and direct decimal values (e.g. `1.2`). Clamped between `0.5` and `3.0`.
- **Advanced Text Search**: Renders search highlights directly onto the PDF text layer and provides a sidebar list of matching snippets with smooth scrolling to search results.
- **Global Page Rotation**: Dual-direction rotation (90° clockwise and counter-clockwise) rendering updated orientations immediately.

### 3. Visual Page Organize Mode (📋 Sorter)
- **Thumbnail Grid View**: Displays index cards for each page, rendering live high-fidelity previews.
- **Drag-and-Drop Reordering**: Rearrange pages by dragging cards into your desired sequence.
- **Page Transformations**: Rotate, duplicate, or delete individual pages directly from card actions.
- **Insert Operations**: Insert blank spaces or choose external files to merge selected pages into the sequence.
- **Premium Multi-Selection**:
  - **Lasso Select (마우스 드래그 선택)**: Drag a selection rectangle over the grid to select multiple pages at once.
  - **Modifier Toggles**: Shift-click to select ranges, and Ctrl/Cmd-click to toggle individual pages.
  - **Batch Actions**: Rotate, duplicate, and delete multiple selected pages in bulk with one click.
- **Undo / Redo (실행 취소/다시 실행) Engine**:
  - Automatically captures deep snapshots before any mutation (moving, duplicating, deleting, inserting, rotating).
  - Isolated history stacks per document tab (switching tabs does not lose history).
  - Bindings for global `Ctrl+Z` (Undo) and `Ctrl+Y` (Redo) shortcuts, alongside interactive toolbar buttons.

### 4. Utility Toolbox Dashboard (🧰 Tools)
- **Compress PDF**: Optimize structures and reduce file size using backend `api.OptimizeFile`.
- **Protect PDF (암호 및 권한 설정)**: Configure User/Owner passwords and restrict print/copy permissions by writing standard security bitmasks.
- **Decrypt PDF**: Strip password protection and security restrictions.
- **Add Watermark**: Stamp custom text overlays behind or on top of pages with size, opacity, rotation, and alignment alignments.
- **Add Page Numbers**: Embed page numbers in custom formats (`Page X of Y`, `Page X`, `— X —`) at selected page corners.
- **Remove Annotations**: Wipe comments, text highlights, stamps, and hyper-references from PDF pages.
- **Manage Attachments**: Read embedded attachments inside a checklist modal and delete selected items.
- **Document Metadata**: View document dictionary keys (Title, Author, Dates) and wipe XML/XMP streams.
- **Flatten Document**: Rasterize all text, layers, and forms into flat image pages.
- **Structure Audit**: Run client-side scans to search catalog dictionaries for JavaScript OpenActions and count external link annotations.
- **Images to PDF**: Batch convert PNG, JPG, and JPEG images into a single compiled PDF file.
- **Export Page Images**: Export high-resolution PNG copies of each page (`scale: 2.0`) to the selected destination folder.

---

## 🛠️ Architecture & Tech Stack

- **Frontend**: Vite + TypeScript compiled down to standard JS modules. Uses PDF.js v4 for high-fidelity browser rendering.
- **Backend**: Go v1.18+ bindings wrapped inside a Wails application. Utilizes `github.com/pdfcpu/pdfcpu` to run advanced low-level PDF dictionary manipulations.
- **Build Tags**: Uses compiler directives (`webkit2_41`) to target newer versions of WebKit2GTK on Linux.

---

## ⚙️ Development & Build Setup

### System Dependencies (Linux/Debian 13)

Before building, install compiler headers for GTK3 and WebKit2GTK:

```bash
sudo apt update
sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev build-essential
```

### 1. Live Development Mode

To start the application in hot-reloading development mode:

```bash
wails dev -tags webkit2_41
```

- Runs Vite hot-module-reload server for the frontend.
- Boots the desktop app shell.
- You can inspect/debug frontend layouts in a web browser at `http://localhost:34115`.

### 2. Compiling Production Binaries

To compile a standalone production binary:

```bash
wails build -tags webkit2_41
```

- Output executable will compile to `build/bin/pdfication`.
- The binary is packaged with all assets embedded, ready for offline execution.

---

## 📂 Project Structure

```
├── app.go             # Go backend methods (Wails API bindings)
├── main.go            # Entrypoint initializing Wails app options
├── go.mod             # Go package declarations (Wails, pdfcpu v0.13.0)
└── frontend/
    ├── src/
    │   ├── main.ts    # Application state, events, and UI routing
    │   ├── app.css    # Colors, layouts, cards, and modal styles
    │   └── style.css  # Typography and baseline browser overrides
    └── package.json   # Frontend packaging metadata (Vite, TypeScript, pdfjs-dist)
```
