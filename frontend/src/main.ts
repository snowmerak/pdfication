import './style.css';
import './app.css';
import * as pdfjsLib from 'pdfjs-dist';

import {
  SelectAndReadPDF,
  ReadPDFFile
} from '../wailsjs/go/main/App';

import {
  tabs,
  activeTabId,
  setActiveTabId,
  isOrganizeMode,
  setIsOrganizeMode,
  isToolboxMode,
  setIsToolboxMode,
  textCaches,
  renderedPages,
  visiblePages,
  selectedPageIndices,
  setLastSelectedIndex,
  getActiveTab,
  formatDate,
  toArrayBuffer,
  registerOnStateChanged,
  triggerUndo,
  triggerRedo,
  RecentFile,
  PDFTab,
  PageItem
} from './state';

import {
  updateDocLayout,
  performSearch,
  initializePageObserver,
  observePage,
  registerOnPageChanged
} from './pdfViewer';

import {
  renderOrganizeGrid,
  renderThumbnails,
  updateActiveThumbnail,
  insertBlankPage,
  insertOtherPDF,
  exportPDFDocument,
  rotateSelectedPages,
  duplicateSelectedPages,
  deleteSelectedPages,
  handleLassoMouseDown
} from './organizeMode';

import {
  handleToolboxCardClick,
  runToolboxAction,
  setSelectedToolPDFPath
} from './toolbox';

// Configure PDFJS worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

// DOM Cache
let tabContainer!: HTMLElement;
let pdfViewer!: HTMLElement;
let sidebar!: HTMLElement;
let thumbnailContainer!: HTMLElement;
let searchResultsContainer!: HTMLElement;
let pageNavInput!: HTMLInputElement;
let pageNavTotal!: HTMLElement;
let zoomInput!: HTMLInputElement;
const textExtractionJobs = new Map<string, Promise<void>>();
let searchInput!: HTMLInputElement;
let recentList!: HTMLElement;
let recentSection!: HTMLElement;
let btnToggleOrganize!: HTMLElement;
let standardToolbarActions!: HTMLElement;
let organizeToolbarActions!: HTMLElement;
let toolboxDashboard!: HTMLElement;
let toolboxModal!: HTMLElement;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupHTML();
  cacheDOM();
  bindEvents();

  // Register Redraw Hooks for Decoupling
  registerOnStateChanged(() => {
    if (isOrganizeMode) {
      renderOrganizeGrid();
    } else {
      const activeTab = getActiveTab();
      if (activeTab) switchTab(activeTab.id);
    }
  });

  registerOnPageChanged(() => {
    updateToolbarPageInput();
    updateActiveThumbnail();
    renderSearchResults();
  });

  showToolboxDashboard(); // Default view is the Toolbox dashboard
});

function setupHTML() {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <div class="tab-bar" id="tab-bar">
      <div class="pdf-tab static-tab active" id="tab-dashboard-btn">🧰 Toolbox</div>
      <button class="add-tab-btn" id="add-tab-btn" title="Open PDF">+</button>
    </div>
    
    <div class="tool-bar" id="tool-bar">
      <div class="toolbar-section">
        <button class="toolbar-btn icon-only" id="btn-toggle-sidebar" title="Toggle Sidebar">📑</button>
        <button class="toolbar-btn" id="btn-open-dialog">📂 Open</button>
        <button class="toolbar-btn" id="btn-toggle-organize" title="Page Layout Sorter">📋 Organize</button>
      </div>
      
      <!-- Standard view options (hidden in Organize/Toolbox Mode) -->
      <div class="toolbar-section" id="standard-toolbar-actions" style="display: none;">
        <button class="toolbar-btn icon-only" id="btn-zoom-out" title="Zoom Out">-</button>
        <input type="text" class="zoom-input" id="zoom-input" list="zoom-options" value="100%">
        <datalist id="zoom-options">
          <option value="50%"></option>
          <option value="75%"></option>
          <option value="100%"></option>
          <option value="125%"></option>
          <option value="150%"></option>
          <option value="200%"></option>
          <option value="300%"></option>
        </datalist>
        <button class="toolbar-btn icon-only" id="btn-zoom-in" title="Zoom In">+</button>
        
        <div class="toolbar-divider"></div>
        
        <button class="toolbar-btn icon-only" id="btn-prev-page" title="Previous Page">◀</button>
        <input type="text" class="page-nav-input" id="page-nav-input" value="1">
        <span class="page-nav-total" id="page-nav-total">/ 0</span>
        <button class="toolbar-btn icon-only" id="btn-next-page" title="Next Page">▶</button>
        
        <div class="toolbar-divider"></div>
        
        <button class="toolbar-btn icon-only" id="btn-rotate-ccw" title="Rotate Counter-Clockwise">↺</button>
        <button class="toolbar-btn icon-only" id="btn-rotate-cw" title="Rotate Clockwise">↻</button>
      </div>
      
      <!-- Organize Mode actions -->
      <div class="toolbar-section" id="organize-toolbar-actions" style="display: none;">
        <button class="toolbar-btn" id="btn-org-blank">+ Blank Page</button>
        <button class="toolbar-btn" id="btn-org-pdf">+ Insert PDF</button>
        
        <div class="toolbar-divider"></div>
        <button class="toolbar-btn icon-only" id="btn-org-undo" title="Undo (Ctrl+Z)" disabled>↶</button>
        <button class="toolbar-btn icon-only" id="btn-org-redo" title="Redo (Ctrl+Y)" disabled>↷</button>
        
        <div class="toolbar-divider" id="org-selection-divider" style="display: none;"></div>
        <button class="toolbar-btn" id="btn-org-rotate-selected" title="Rotate Selected Pages" style="display: none;">↻ Rotate Selected</button>
        <button class="toolbar-btn" id="btn-org-dup-selected" title="Duplicate Selected Pages" style="display: none;">📄 Duplicate Selected</button>
        <button class="toolbar-btn delete" id="btn-org-del-selected" title="Delete Selected Pages" style="display: none;">✕ Delete Selected</button>
        
        <div class="toolbar-divider"></div>
        <button class="toolbar-btn active" id="btn-org-save">💾 Save PDF</button>
      </div>
      
      <div class="toolbar-section" id="search-toolbar-section" style="display: none;">
        <div class="search-box" id="search-box">
          <input type="text" class="search-input" id="search-input" placeholder="Search text...">
          <button class="search-nav-btn" id="btn-search-prev" title="Previous match">▲</button>
          <button class="search-nav-btn" id="btn-search-next" title="Next match">▼</button>
        </div>
      </div>
    </div>
    
    <div class="main-workspace" id="main-workspace">
      <div class="sidebar" id="sidebar" style="display: none;">
        <div class="sidebar-header">
          <div class="sidebar-tab active" id="tab-thumbnails-btn">Pages</div>
          <div class="sidebar-tab" id="tab-search-btn">Search</div>
        </div>
        <div class="sidebar-content">
          <div class="thumbnail-container" id="thumbnail-container"></div>
          <div class="sidebar-search-results" id="sidebar-search-results" style="display: none;">
            <div class="search-no-results">No query entered</div>
          </div>
        </div>
      </div>
      
      <div class="viewer-container" id="viewer-container">
        <div class="pdf-viewer" id="pdf-viewer" style="display: none;"></div>
        
        <!-- Toolbox Dashboard (Unified Welcome Screen + Toolbox Grid + Recents) -->
        <div class="toolbox-container" id="toolbox-dashboard">
          <div class="welcome-header" style="text-align:center; margin-bottom: 30px; margin-top: 15px;">
            <div class="welcome-logo" id="welcome-logo-btn" style="cursor:pointer; display:inline-block; font-size: 38px;" title="Welcome logo">pdfication</div>
            <div class="welcome-subtitle" style="font-size: 15px; color: var(--text-muted); margin-top: 5px;">A Premium desktop PDF utility workspace</div>
          </div>
          
          <div class="welcome-section-row" style="display:flex; justify-content:center;">
            <div class="welcome-right" style="width: 100%; max-width: 1200px;">
              <div class="toolbox-title">PDF Utility Toolbox</div>
              <div class="toolbox-grid">
                <div class="toolbox-card" data-tool="compress">
                  <div class="toolbox-card-icon">🗜️</div>
                  <div class="toolbox-card-title">Compress PDF</div>
                  <div class="toolbox-card-desc">Reduce the file size of your PDF document while optimizing quality.</div>
                </div>
                <div class="toolbox-card" data-tool="protect">
                  <div class="toolbox-card-icon">🔒</div>
                  <div class="toolbox-card-title">Protect PDF</div>
                  <div class="toolbox-card-desc">Encrypt PDF with passwords and restrict print/copy permissions.</div>
                </div>
                <div class="toolbox-card" data-tool="decrypt">
                  <div class="toolbox-card-icon">🔓</div>
                  <div class="toolbox-card-title">Decrypt PDF</div>
                  <div class="toolbox-card-desc">Remove password protection and security restrictions.</div>
                </div>
                <div class="toolbox-card" data-tool="watermark">
                  <div class="toolbox-card-icon">📝</div>
                  <div class="toolbox-card-title">Add Watermark</div>
                  <div class="toolbox-card-desc">Add a custom stylized text stamp behind or on top of pages.</div>
                </div>
                <div class="toolbox-card" data-tool="number">
                  <div class="toolbox-card-icon">🔢</div>
                  <div class="toolbox-card-title">Add Page Numbers</div>
                  <div class="toolbox-card-desc">Render page numbers in custom formats and positions.</div>
                </div>
                <div class="toolbox-card" data-tool="remove-annotations">
                  <div class="toolbox-card-icon">💬</div>
                  <div class="toolbox-card-title">Remove Annotations</div>
                  <div class="toolbox-card-desc">Wipe all interactive annotations, highlights, comments, and links.</div>
                </div>
                <div class="toolbox-card" data-tool="attachments">
                  <div class="toolbox-card-icon">📎</div>
                  <div class="toolbox-card-title">Manage Attachments</div>
                  <div class="toolbox-card-desc">Inspect and delete embedded file attachments.</div>
                </div>
                <div class="toolbox-card" data-tool="metadata">
                  <div class="toolbox-card-icon">ℹ️</div>
                  <div class="toolbox-card-title">Document Metadata</div>
                  <div class="toolbox-card-desc">Check document properties and clean metadata records.</div>
                </div>
                <div class="toolbox-card" data-tool="flatten">
                  <div class="toolbox-card-icon">🥞</div>
                  <div class="toolbox-card-title">Flatten Document</div>
                  <div class="toolbox-card-desc">Rasterize all text, layers, and forms into flat image pages.</div>
                </div>
                <div class="toolbox-card" data-tool="audit">
                  <div class="toolbox-card-icon">🔍</div>
                  <div class="toolbox-card-title">Structure Audit</div>
                  <div class="toolbox-card-desc">Audit document for external links and JavaScript actions.</div>
                </div>
                <div class="toolbox-card" data-tool="images-to-pdf">
                  <div class="toolbox-card-icon">🖼️</div>
                  <div class="toolbox-card-title">Images to PDF</div>
                  <div class="toolbox-card-desc">Convert PNG, JPG, and JPEG images into a single compiled PDF.</div>
                </div>
                <div class="toolbox-card" data-tool="export-images">
                  <div class="toolbox-card-icon">📷</div>
                  <div class="toolbox-card-title">Export Page Images</div>
                  <div class="toolbox-card-desc">Convert pages of your PDF into high-resolution PNG image files.</div>
                </div>
                <div class="toolbox-card" data-tool="organize">
                  <div class="toolbox-card-icon">📋</div>
                  <div class="toolbox-card-title">Organize PDF</div>
                  <div class="toolbox-card-desc">Reorder, delete, rotate, duplicate, or merge pages visually.</div>
                </div>
              </div>
            </div>
          </div>
          
          <div class="recent-section" id="recent-section" style="display: none;">
            <div class="recent-title">Recent Files</div>
            <div class="recent-list" id="recent-list"></div>
          </div>
        </div>
      </div>
    </div>
    
    <div class="modal-overlay" id="password-modal">
      <div class="modal-card">
        <div class="modal-title">Password Required</div>
        <div class="modal-desc" id="password-modal-desc">This PDF document is encrypted. Please enter the password.</div>
        <input type="password" id="password-input" class="password-input" placeholder="Enter password">
        <div class="modal-buttons">
          <button class="welcome-btn secondary" id="btn-password-cancel">Cancel</button>
          <button class="welcome-btn" id="btn-password-submit">Submit</button>
        </div>
      </div>
    </div>

    <!-- Toolbox Config Modal -->
    <div class="modal-overlay" id="toolbox-modal">
      <div class="modal-card">
        <div class="modal-title" id="toolbox-modal-title">Tool Configuration</div>
        <div class="toolbox-form" id="toolbox-form-container">
          <!-- Populated dynamically based on clicked card -->
        </div>
        <div class="modal-buttons">
          <button class="welcome-btn secondary" id="toolbox-cancel-btn">Cancel</button>
          <button class="welcome-btn" id="toolbox-submit-btn">Run Action</button>
        </div>
      </div>
    </div>
  `;
}

function cacheDOM() {
  tabContainer = document.getElementById('tab-bar')!;
  pdfViewer = document.getElementById('pdf-viewer')!;
  sidebar = document.getElementById('sidebar')!;
  thumbnailContainer = document.getElementById('thumbnail-container')!;
  searchResultsContainer = document.getElementById('sidebar-search-results')!;
  pageNavInput = document.getElementById('page-nav-input') as HTMLInputElement;
  pageNavTotal = document.getElementById('page-nav-total')!;
  zoomInput = document.getElementById('zoom-input') as HTMLInputElement;
  searchInput = document.getElementById('search-input') as HTMLInputElement;
  recentList = document.getElementById('recent-list')!;
  recentSection = document.getElementById('recent-section')!;

  btnToggleOrganize = document.getElementById('btn-toggle-organize')!;
  standardToolbarActions = document.getElementById('standard-toolbar-actions')!;
  organizeToolbarActions = document.getElementById('organize-toolbar-actions')!;
  toolboxDashboard = document.getElementById('toolbox-dashboard')!;
  toolboxModal = document.getElementById('toolbox-modal')!;
}

function bindEvents() {
  document.getElementById('add-tab-btn')!.addEventListener('click', openPDFDialog);
  document.getElementById('btn-open-dialog')!.addEventListener('click', openPDFDialog);
  document.getElementById('tab-dashboard-btn')!.addEventListener('click', showToolboxDashboard);

  // Logo button click to navigate back to dashboard
  document.getElementById('welcome-logo-btn')!.addEventListener('click', showToolboxDashboard);

  // Mode toggles
  btnToggleOrganize.addEventListener('click', toggleOrganizeMode);

  // Organize Actions
  document.getElementById('btn-org-blank')!.addEventListener('click', insertBlankPage);
  document.getElementById('btn-org-pdf')!.addEventListener('click', insertOtherPDF);
  document.getElementById('btn-org-undo')!.addEventListener('click', triggerUndo);
  document.getElementById('btn-org-redo')!.addEventListener('click', triggerRedo);
  document.getElementById('btn-org-rotate-selected')!.addEventListener('click', rotateSelectedPages);
  document.getElementById('btn-org-dup-selected')!.addEventListener('click', duplicateSelectedPages);
  document.getElementById('btn-org-del-selected')!.addEventListener('click', deleteSelectedPages);
  document.getElementById('btn-org-save')!.addEventListener('click', exportPDFDocument);

  // Lasso selection on organize grid
  pdfViewer.addEventListener('mousedown', handleLassoMouseDown);

  // Toolbox Grid Card Click Bindings
  document.querySelectorAll('.toolbox-card').forEach(card => {
    card.addEventListener('click', () => {
      const tool = card.getAttribute('data-tool');
      if (tool === 'organize') {
        const activeTab = getActiveTab();
        if (activeTab) {
          setIsOrganizeMode(false);
          toggleOrganizeMode();
        } else {
          openPDFDialog();
        }
      } else if (tool) {
        handleToolboxCardClick(tool);
      }
    });
  });

  // Toolbox Modal Actions
  document.getElementById('toolbox-cancel-btn')!.addEventListener('click', () => {
    toolboxModal.classList.remove('show');
  });
  document.getElementById('toolbox-submit-btn')!.addEventListener('click', runToolboxAction);

  // Prevent browser window from opening dropped files natively
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  // Zoom
  document.getElementById('btn-zoom-out')!.addEventListener('click', () => adjustZoom(-0.25));
  document.getElementById('btn-zoom-in')!.addEventListener('click', () => adjustZoom(0.25));
  zoomInput.addEventListener('change', () => {
    parseAndSetZoom(zoomInput.value);
  });
  zoomInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      parseAndSetZoom(zoomInput.value);
      zoomInput.blur();
    }
  });

  // Navigation
  document.getElementById('btn-prev-page')!.addEventListener('click', () => navigatePage(-1));
  document.getElementById('btn-next-page')!.addEventListener('click', () => navigatePage(1));
  pageNavInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const pageNum = parseInt(pageNavInput.value);
      const tab = getActiveTab();
      if (tab && pageNum >= 1 && pageNum <= tab.pages.length) {
        const el = document.querySelector(`.page-wrapper[data-page-number="${pageNum}"]`);
        if (el) el.scrollIntoView();
      }
      pageNavInput.blur();
    }
  });

  // Dual Page Rotation
  document.getElementById('btn-rotate-ccw')!.addEventListener('click', () => rotateDocument(-90));
  document.getElementById('btn-rotate-cw')!.addEventListener('click', () => rotateDocument(90));

  // Sidebar toggle
  document.getElementById('btn-toggle-sidebar')!.addEventListener('click', () => {
    sidebar.style.display = sidebar.style.display === 'none' ? 'flex' : 'none';
  });

  // Sidebar tabs
  const tabThumbnails = document.getElementById('tab-thumbnails-btn')!;
  const tabSearch = document.getElementById('tab-search-btn')!;
  tabThumbnails.addEventListener('click', () => {
    tabThumbnails.classList.add('active');
    tabSearch.classList.remove('active');
    thumbnailContainer.style.display = 'block';
    searchResultsContainer.style.display = 'none';
  });
  tabSearch.addEventListener('click', () => {
    tabSearch.classList.add('active');
    tabThumbnails.classList.remove('active');
    searchResultsContainer.style.display = 'block';
    thumbnailContainer.style.display = 'none';
  });

  // Search input triggers
  searchInput.addEventListener('input', () => {
    const query = searchInput.value;
    performSearch(query);
    const tab = getActiveTab();
    if (tab && query) {
      ensureTextExtracted(tab).then(() => {
        if (getActiveTab()?.id === tab.id && tab.searchQuery) {
          performSearch(tab.searchQuery);
        }
      });
    }
  });
  document.getElementById('btn-search-prev')!.addEventListener('click', () => navigateSearchMatch(-1));
  document.getElementById('btn-search-next')!.addEventListener('click', () => navigateSearchMatch(1));
}

// File loading
async function openPDFDialog() {
  try {
    const result = await SelectAndReadPDF();
    if (result && result.data) {
      const arrayBuffer = toArrayBuffer(result.data);
      if (arrayBuffer.byteLength > 0) {
        await loadPDFDocument(result.name, arrayBuffer, result.path);
      }
    }
  } catch (err) {
    console.error('Failed to open PDF selection:', err);
  }
}



async function loadPDFDocument(name: string, arrayBuffer: ArrayBuffer, path?: string, password?: string) {
  try {
    const loadingTask = pdfjsLib.getDocument({
      data: arrayBuffer,
      password: password
    });
    const pdfDoc = await loadingTask.promise;
    createTab(name, arrayBuffer, pdfDoc, path);
    if (path) {
      addToRecentFiles(name, path);
    }
  } catch (error: any) {
    if (error.name === 'PasswordException') {
      const pswd = await promptPassword(name, error.message !== 'Incorrect password');
      if (pswd !== null) {
        await loadPDFDocument(name, arrayBuffer, path, pswd);
      }
    } else {
      alert(`Error loading PDF: ${error.message}`);
    }
  }
}

function createTab(name: string, arrayBuffer: ArrayBuffer, pdfDoc: pdfjsLib.PDFDocumentProxy, path?: string) {
  const id = `${name}-${Date.now()}`;

  const pages: PageItem[] = [];
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    pages.push({
      id: `${id}-p${i}-${Date.now()}-${Math.random()}`,
      docId: id,
      path: path,
      originalPageNum: i,
      rotation: 0,
      isBlank: false
    });
  }

  const newTab: PDFTab = {
    id,
    name,
    path,
    pdfDoc,
    currentPage: 1,
    zoom: 1.0,
    rotation: 0,
    searchQuery: '',
    searchResults: [],
    currentMatchIndex: -1,
    arrayBuffer,
    pages,
    undoStack: [],
    redoStack: []
  };

  tabs.push(newTab);

  const textCache: string[] = [];
  textCaches.set(id, textCache);

  switchTab(id);

  // Prefetch individual page dimensions in background
  (async () => {
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      try {
        const page = await pdfDoc.getPage(i);
        const vp = page.getViewport({ scale: 1.0 });
        pages[i - 1].width = vp.width;
        pages[i - 1].height = vp.height;
      } catch (e) {
        console.error(`Failed to load page ${i} bounds:`, e);
      }
    }
    // Refresh page wrapper dimensions
    if (activeTabId === id) {
      updateDocLayout();
    }
  })();
}

function waitForIdle(): Promise<void> {
  return new Promise(resolve => {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(() => resolve(), { timeout: 100 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

function ensureTextExtracted(tab: PDFTab): Promise<void> {
  const existingJob = textExtractionJobs.get(tab.id);
  if (existingJob) return existingJob;

  const cache = textCaches.get(tab.id) || [];
  textCaches.set(tab.id, cache);
  const firstPage = Math.max(1, Math.min(tab.currentPage, tab.pdfDoc.numPages));
  const pageOrder = [
    firstPage,
    ...Array.from({ length: tab.pdfDoc.numPages }, (_, index) => index + 1)
      .filter(pageNum => pageNum !== firstPage)
  ];

  const job = extractText(tab, cache, pageOrder).finally(() => {
    textExtractionJobs.delete(tab.id);
  });
  textExtractionJobs.set(tab.id, job);
  return job;
}

async function extractText(tab: PDFTab, cache: string[], pageOrder: number[]) {
  for (const pageNum of pageOrder) {
    if (!tabs.some(candidate => candidate.id === tab.id)) return;
    if (cache[pageNum] !== undefined) continue;
    await waitForIdle();
    try {
      const page = await tab.pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();
      const text = textContent.items.map((item: any) => item.str).join(' ');
      cache[pageNum] = text;
    } catch (e) {
      console.error(`Error caching page ${pageNum} text:`, e);
    }
  }
}

// Password Prompt Modal dialog
function promptPassword(name: string, isFirstAttempt: boolean): Promise<string | null> {
  const modal = document.getElementById('password-modal')!;
  const desc = document.getElementById('password-modal-desc')!;
  const input = document.getElementById('password-input') as HTMLInputElement;
  const submit = document.getElementById('btn-password-submit')!;
  const cancel = document.getElementById('btn-password-cancel')!;

  desc.innerText = isFirstAttempt
    ? `"${name}" is encrypted. Enter password.`
    : `Incorrect password for "${name}". Try again.`;
  input.value = '';
  modal.classList.add('show');
  input.focus();

  return new Promise((resolve) => {
    const handleClose = (value: string | null) => {
      modal.classList.remove('show');
      submit.removeEventListener('click', handleSubmit);
      cancel.removeEventListener('click', handleCancel);
      input.removeEventListener('keydown', handleKeydown);
      resolve(value);
    };

    const handleSubmit = () => handleClose(input.value);
    const handleCancel = () => handleClose(null);
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') handleSubmit();
      if (e.key === 'Escape') handleCancel();
    };

    submit.addEventListener('click', handleSubmit);
    cancel.addEventListener('click', handleCancel);
    input.addEventListener('keydown', handleKeydown);
  });
}

// Tab Operations
function renderTabs() {
  const tabsList = tabContainer.querySelectorAll('.pdf-tab:not(.static-tab)');
  tabsList.forEach(el => el.remove());

  tabs.forEach(tab => {
    const tabEl = document.createElement('div');
    tabEl.className = `pdf-tab ${tab.id === activeTabId ? 'active' : ''}`;
    tabEl.innerText = tab.name;
    tabEl.addEventListener('click', () => switchTab(tab.id));

    const closeBtn = document.createElement('span');
    closeBtn.className = 'close-tab-btn';
    closeBtn.innerHTML = '✕';
    closeBtn.title = 'Close tab';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });

    tabEl.appendChild(closeBtn);
    tabContainer.insertBefore(tabEl, document.getElementById('add-tab-btn')!);
  });

  const staticTab = document.getElementById('tab-dashboard-btn')!;
  if (isToolboxMode) {
    staticTab.classList.add('active');
  } else {
    staticTab.classList.remove('active');
  }
}

function switchTab(id: string) {
  setActiveTabId(id);
  setIsToolboxMode(false);
  setIsOrganizeMode(false);

  const tab = getActiveTab();
  if (!tab) return;

  btnToggleOrganize.classList.remove('active');
  btnToggleOrganize.style.display = 'inline-flex';
  document.getElementById('btn-toggle-sidebar')!.style.display = 'inline-flex';

  renderTabs();

  standardToolbarActions.style.display = 'flex';
  organizeToolbarActions.style.display = 'none';
  document.getElementById('search-toolbar-section')!.style.display = 'flex';

  pdfViewer.className = 'pdf-viewer';
  pdfViewer.style.removeProperty('display');
  toolboxDashboard.style.display = 'none';
  sidebar.style.display = sidebar.style.display === 'none' ? 'none' : 'flex';

  setSelectedToolPDFPath(tab.path || '');

  // Render viewport page wrappers
  pdfViewer.innerHTML = '';
  initializePageObserver(document.getElementById('viewer-container')!);
  visiblePages.clear();
  renderedPages.clear();

  tab.pages.forEach((_, index) => {
    const pageNum = index + 1;
    const wrapper = document.createElement('div');
    wrapper.className = 'page-wrapper';
    wrapper.setAttribute('data-page-number', pageNum.toString());
    wrapper.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">Scroll to load</div>`;

    pdfViewer.appendChild(wrapper);
    observePage(wrapper);
  });

  zoomInput.value = Math.round(tab.zoom * 100) + '%';
  pageNavTotal.innerText = `/ ${tab.pages.length}`;
  searchInput.value = tab.searchQuery;
  updateToolbarPageInput();

  renderThumbnails(tab);
  renderSearchResults();
  updateDocLayout();
}

function closeTab(id: string) {
  const index = tabs.findIndex(t => t.id === id);
  if (index === -1) return;

  const closedTab = tabs[index];
  if (closedTab && closedTab.pdfDoc) {
    try {
      (closedTab.pdfDoc as any).destroy?.();
      (closedTab.pdfDoc as any).cleanup?.();
    } catch (e) {
      console.warn('pdfDoc cleanup failed:', e);
    }
  }

  tabs.splice(index, 1);
  textCaches.delete(id);
  textExtractionJobs.delete(id);

  if (activeTabId === id) {
    if (tabs.length > 0) {
      switchTab(tabs[Math.max(0, index - 1)].id);
    } else {
      showToolboxDashboard();
    }
  } else {
    renderTabs();
  }
}

// Toolbox Dashboard Layout
function showToolboxDashboard() {
  setActiveTabId(null);
  setIsToolboxMode(true);
  setIsOrganizeMode(false);

  btnToggleOrganize.classList.remove('active');
  btnToggleOrganize.style.display = 'none';
  document.getElementById('btn-toggle-sidebar')!.style.display = 'none';
  sidebar.style.display = 'none';

  renderTabs();

  standardToolbarActions.style.display = 'none';
  organizeToolbarActions.style.display = 'none';
  document.getElementById('search-toolbar-section')!.style.display = 'none';

  pdfViewer.style.display = 'none';
  toolboxDashboard.style.display = 'block';

  renderRecentFiles();
}

// Mode toggle
function toggleOrganizeMode() {
  const tab = getActiveTab();
  if (!tab) return;

  setIsOrganizeMode(!isOrganizeMode);
  setIsToolboxMode(false);
  selectedPageIndices.clear();
  setLastSelectedIndex(null);

  if (isOrganizeMode) {
    btnToggleOrganize.classList.add('active');
    standardToolbarActions.style.display = 'none';
    organizeToolbarActions.style.display = 'flex';
    document.getElementById('search-toolbar-section')!.style.display = 'none';

    pdfViewer.style.removeProperty('display');
    toolboxDashboard.style.display = 'none';
    pdfViewer.className = 'organize-grid';
    renderOrganizeGrid();
  } else {
    btnToggleOrganize.classList.remove('active');
    standardToolbarActions.style.display = 'flex';
    organizeToolbarActions.style.display = 'none';
    document.getElementById('search-toolbar-section')!.style.display = 'flex';

    pdfViewer.style.removeProperty('display');
    toolboxDashboard.style.display = 'none';
    pdfViewer.className = 'pdf-viewer';
    switchTab(tab.id);
  }
}

// Zoom adjustments
function adjustZoom(delta: number) {
  const tab = getActiveTab();
  if (!tab) return;
  const newZoom = Math.max(0.5, Math.min(3.0, tab.zoom + delta));
  setZoom(newZoom);
}

function setZoom(val: number) {
  const tab = getActiveTab();
  if (!tab) return;
  tab.zoom = val;
  zoomInput.value = Math.round(val * 100) + '%';
  updateDocLayout();
}

function parseAndSetZoom(text: string) {
  const tab = getActiveTab();
  if (!tab) return;

  let num = parseFloat(text.replace(/[^0-9.]/g, ''));
  if (isNaN(num)) {
    setZoom(tab.zoom);
    return;
  }

  if (text.includes('%') || num > 3.0) {
    num = num / 100;
  }

  const newZoom = Math.max(0.5, Math.min(3.0, num));
  setZoom(newZoom);
}

// Navigation
function navigatePage(direction: number) {
  const tab = getActiveTab();
  if (!tab) return;

  const targetPage = Math.max(1, Math.min(tab.pages.length, tab.currentPage + direction));
  const el = document.querySelector(`.page-wrapper[data-page-number="${targetPage}"]`);
  if (el) el.scrollIntoView();
}

function updateToolbarPageInput() {
  const tab = getActiveTab();
  if (tab) {
    pageNavInput.value = tab.currentPage.toString();
  }
}

// Rotate Document viewport
function rotateDocument(degrees: number) {
  const tab = getActiveTab();
  if (!tab) return;

  tab.rotation = (tab.rotation + degrees + 360) % 360;
  updateDocLayout();
  renderThumbnails(tab);
}

// Search UI list rendering
function renderSearchResults() {
  const tab = getActiveTab();
  if (!tab) return;

  if (tab.searchResults.length === 0) {
    searchResultsContainer.innerHTML = `<div class="search-no-results">
      ${tab.searchQuery ? 'No results found' : 'No query entered'}
    </div>`;
    return;
  }

  searchResultsContainer.innerHTML = '';
  tab.searchResults.forEach(match => {
    const card = document.createElement('div');
    card.className = `search-match-card ${match.matchIndex === tab.currentMatchIndex ? 'active' : ''}`;
    card.innerHTML = `
      <div class="search-match-header">Page ${match.pageNumber}</div>
      <div class="search-match-text">${match.text}</div>
    `;
    card.addEventListener('click', () => {
      selectSearchMatch(match.matchIndex);
    });
    searchResultsContainer.appendChild(card);
  });
}

function selectSearchMatch(index: number) {
  const tab = getActiveTab();
  if (!tab || index < 0 || index >= tab.searchResults.length) return;

  tab.currentMatchIndex = index;
  renderSearchResults();

  const match = tab.searchResults[index];
  const el = document.querySelector(`.page-wrapper[data-page-number="${match.pageNumber}"]`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth' });
  }
}

function navigateSearchMatch(direction: number) {
  const tab = getActiveTab();
  if (!tab || tab.searchResults.length === 0) return;

  let newIdx = tab.currentMatchIndex + direction;
  if (newIdx < 0) newIdx = tab.searchResults.length - 1;
  if (newIdx >= tab.searchResults.length) newIdx = 0;

  selectSearchMatch(newIdx);
}

// Recent Files storage handlers
function renderRecentFiles() {
  const recents: RecentFile[] = JSON.parse(localStorage.getItem('recentFiles') || '[]');
  if (recents.length === 0) {
    recentSection.style.display = 'none';
    recentList.innerHTML = '';
    return;
  }

  recentSection.style.display = 'block';
  recentList.innerHTML = '';

  recents.forEach(file => {
    const item = document.createElement('div');
    item.className = 'recent-item';
    item.addEventListener('click', () => openRecentFile(file.path, file.name));

    const info = document.createElement('div');
    info.className = 'recent-item-info';

    const name = document.createElement('div');
    name.className = 'recent-item-name';
    name.innerText = file.name;

    const path = document.createElement('div');
    path.className = 'recent-item-path';
    path.innerText = file.path;
    path.title = file.path;

    info.appendChild(name);
    info.appendChild(path);

    const time = document.createElement('div');
    time.className = 'recent-item-time';
    time.innerText = formatDate(file.timestamp);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'recent-item-remove';
    removeBtn.innerHTML = '✕';
    removeBtn.title = 'Remove from recent';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromRecentFiles(file.path);
    });

    item.appendChild(info);
    item.appendChild(time);
    item.appendChild(removeBtn);
    recentList.appendChild(item);
  });
}

async function openRecentFile(path: string, name: string) {
  try {
    const data = await ReadPDFFile(path);
    if (data) {
      const arrayBuffer = toArrayBuffer(data);
      if (arrayBuffer.byteLength > 0) {
        await loadPDFDocument(name, arrayBuffer, path);
        return;
      }
    }
    throw new Error('Empty file content');
  } catch (err: any) {
    alert(`Could not open file: ${err.message || err}`);
    removeFromRecentFiles(path);
  }
}

function addToRecentFiles(name: string, path: string) {
  let recents: RecentFile[] = JSON.parse(localStorage.getItem('recentFiles') || '[]');
  recents = recents.filter(f => f.path !== path);
  recents.unshift({ name, path, timestamp: Date.now() });

  if (recents.length > 10) {
    recents = recents.slice(0, 10);
  }

  localStorage.setItem('recentFiles', JSON.stringify(recents));
}

function removeFromRecentFiles(path: string) {
  let recents: RecentFile[] = JSON.parse(localStorage.getItem('recentFiles') || '[]');
  recents = recents.filter(f => f.path !== path);
  localStorage.setItem('recentFiles', JSON.stringify(recents));
  renderRecentFiles();
}
