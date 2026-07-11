import * as pdfjsLib from 'pdfjs-dist';

export interface PageItem {
  id: string;
  docId: string;
  path?: string;
  originalPageNum: number;
  rotation: number;
  isBlank: boolean;
  width?: number;
  height?: number;
}

export interface PDFTab {
  id: string;
  name: string;
  path?: string;
  pdfDoc: pdfjsLib.PDFDocumentProxy;
  currentPage: number;
  zoom: number;
  rotation: number;
  searchQuery: string;
  searchResults: SearchMatch[];
  currentMatchIndex: number;
  arrayBuffer: ArrayBuffer;
  pages: PageItem[];
  undoStack: PageItem[][];
  redoStack: PageItem[][];
}

export interface SearchMatch {
  pageNumber: number;
  text: string;
  matchIndex: number;
}

export interface RecentFile {
  name: string;
  path: string;
  timestamp: number;
}

// Global Application State Models
export let tabs: PDFTab[] = [];
export function setTabs(val: PDFTab[]) { tabs = val; }

export let activeTabId: string | null = null;
export function setActiveTabId(val: string | null) { activeTabId = val; }

export const textCaches = new Map<string, string[]>();
export const renderedPages = new Set<number>();
export const visiblePages = new Set<number>();

export let passwordResolver: ((val: string | null) => void) | null = null;
export function setPasswordResolver(val: ((val: string | null) => void) | null) { passwordResolver = val; }

export let isOrganizeMode = false;
export function setIsOrganizeMode(val: boolean) { isOrganizeMode = val; }

export let isToolboxMode = true;
export function setIsToolboxMode(val: boolean) { isToolboxMode = val; }

export let dragSrcIndex: number | null = null;
export function setDragSrcIndex(val: number | null) { dragSrcIndex = val; }

export let selectedPageIndices = new Set<number>();
export let lastSelectedIndex: number | null = null;
export function setLastSelectedIndex(val: number | null) { lastSelectedIndex = val; }

export function getActiveTab(): PDFTab | null {
  return tabs.find(t => t.id === activeTabId) || null;
}

// State Change Redraw Hook Listener
let onStateChangedCallback: (() => void) | null = null;
export function registerOnStateChanged(cb: () => void) {
  onStateChangedCallback = cb;
}

// Undo/Redo historical operations stack
export function pushHistory(tab: PDFTab) {
  if (!tab.undoStack) tab.undoStack = [];
  if (!tab.redoStack) tab.redoStack = [];

  // Deep copy sequence spec
  tab.undoStack.push(tab.pages.map(p => ({ ...p })));
  tab.redoStack = [];

  if (tab.undoStack.length > 50) {
    tab.undoStack.shift();
  }
  updateUndoRedoButtons();
}

export function triggerUndo() {
  const tab = getActiveTab();
  if (!tab || !tab.undoStack || tab.undoStack.length === 0) return;

  if (!tab.redoStack) tab.redoStack = [];
  tab.redoStack.push(tab.pages.map(p => ({ ...p })));

  tab.pages = tab.undoStack.pop()!;
  selectedPageIndices.clear();
  setLastSelectedIndex(null);

  if (onStateChangedCallback) onStateChangedCallback();
  updateUndoRedoButtons();
}

export function triggerRedo() {
  const tab = getActiveTab();
  if (!tab || !tab.redoStack || tab.redoStack.length === 0) return;

  if (!tab.undoStack) tab.undoStack = [];
  tab.undoStack.push(tab.pages.map(p => ({ ...p })));

  tab.pages = tab.redoStack.pop()!;
  selectedPageIndices.clear();
  setLastSelectedIndex(null);

  if (onStateChangedCallback) onStateChangedCallback();
  updateUndoRedoButtons();
}

export function updateUndoRedoButtons() {
  const tab = getActiveTab();
  const undoBtn = document.getElementById('btn-org-undo') as HTMLButtonElement;
  const redoBtn = document.getElementById('btn-org-redo') as HTMLButtonElement;
  if (!undoBtn || !redoBtn) return;

  if (tab && isOrganizeMode) {
    undoBtn.disabled = !(tab.undoStack && tab.undoStack.length > 0);
    redoBtn.disabled = !(tab.redoStack && tab.redoStack.length > 0);
  } else {
    undoBtn.disabled = true;
    redoBtn.disabled = true;
  }
}

// Utility Helpers
export function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

export function toArrayBuffer(data: any): ArrayBuffer {
  if (typeof data === 'string') {
    const binaryString = atob(data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
  if (Array.isArray(data)) {
    return new Uint8Array(data).buffer;
  }
  throw new Error('Unsupported ArrayBuffer format');
}

export function filepathBase(path: string): string {
  const separator = path.includes('/') ? '/' : '\\';
  const parts = path.split(separator);
  return parts[parts.length - 1] || 'document.pdf';
}
