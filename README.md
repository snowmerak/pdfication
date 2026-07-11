# pdfication

Premium desktop PDF viewer app built with Wails (Go) + Vanilla TypeScript (Vite) + PDF.js.

## Dependencies

Before developing or compiling on Linux (specifically modern distributions like Debian 13 / Ubuntu 22.04+), ensure WebKit2GTK 4.1 development libraries are installed:

```bash
sudo apt update
sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev
```

## Live Development

To start the application in hot-reloading development mode:

```bash
wails dev -tags webkit2_41
```

- Runs a Vite dev server for hot-reloading frontend changes.
- Launches the Wails window dynamically.
- Accessible via a browser at `http://localhost:34115` to debug Go bindings in devtools.

## Building for Production

To build a standalone production binary:

```bash
wails build -tags webkit2_41
```

- The output binary will be generated under `build/bin/pdfication`.
- Compiled using the `webkit2_41` tag to link against the correct ABI version on Debian 13.

