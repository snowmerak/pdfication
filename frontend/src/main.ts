import './style.css';
import './app.css';

import { SelectAndReadPDF, ReadPDFFile, SelectSavePath, ExportPDF } from '../wailsjs/go/main/App';
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDFJS worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

// Typings
interface PageItem {
  id: string;
  docId: string;
  path?: string;
  originalPageNum: number;
  rotation: number; // page-level rotation (0, 90, 180, 270)
  isBlank: boolean;
}

interface PDFTab {
  id: string;
  name: string;
  path?: string;
  pdfDoc: pdfjsLib.PDFDocumentProxy;
  currentPage: number;
  zoom: number;
  rotation: number; // tab-level rotation (0, 90, 180, 270)
  searchQuery: string;
  searchResults: SearchMatch[];
  currentMatchIndex: number;
  arrayBuffer: ArrayBuffer;
  pages: PageItem[];
}

interface SearchMatch {
  pageNumber: number;
  text: string;
  matchIndex: number;
}

interface RecentFile {
  name: string;
  path: string;
  timestamp: number;
}

// State
let tabs: PDFTab[] = [];
let activeTabId: string | null = null;
const textCaches = new Map<string, string[]>(); // Map tabId -> array of page strings
const renderedPages = new Set<number>();
const visiblePages = new Set<number>();
let passwordResolver: ((val: string | null) => void) | null = null;
let isOrganizeMode = false;
let dragSrcIndex: number | null = null;

// DOM Cache
let welcomeScreen!: HTMLElement;
let tabContainer!: HTMLElement;
let toolBar!: HTMLElement;
let mainWorkspace!: HTMLElement;
let viewerContainer!: HTMLElement;
let pdfViewer!: HTMLElement;
let sidebar!: HTMLElement;
let thumbnailContainer!: HTMLElement;
let searchResultsContainer!: HTMLElement;
let pageNavInput!: HTMLInputElement;
let pageNavTotal!: HTMLElement;
let zoomInput!: HTMLInputElement;
let searchInput!: HTMLInputElement;
let recentList!: HTMLElement;
let recentSection!: HTMLElement;

// Organize Mode DOM Cache
let btnToggleOrganize!: HTMLElement;
let standardToolbarActions!: HTMLElement;
let organizeToolbarActions!: HTMLElement;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupHTML();
  cacheDOM();
  bindEvents();
  renderRecentFiles();
});

function setupHTML() {
  const app = document.getElementById('app')!;
  app.innerHTML = `
    <div class="tab-bar" id="tab-bar">
      <button class="add-tab-btn" id="add-tab-btn" title="Open PDF">+</button>
    </div>
    
    <div class="tool-bar" id="tool-bar" style="display: none;">
      <div class="toolbar-section">
        <button class="toolbar-btn icon-only" id="btn-toggle-sidebar" title="Toggle Sidebar">📑</button>
        <button class="toolbar-btn" id="btn-open-dialog">📂 Open</button>
        <button class="toolbar-btn" id="btn-toggle-organize" title="Page Layout Sorter">📋 Organize Mode</button>
      </div>
      
      <!-- Standard view options (hidden in Organize Mode) -->
      <div class="toolbar-section" id="standard-toolbar-actions">
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
      
      <!-- Organize Mode actions (visible only in Organize Mode) -->
      <div class="toolbar-section" id="organize-toolbar-actions" style="display: none;">
        <button class="toolbar-btn" id="btn-org-blank">+ Blank Page</button>
        <button class="toolbar-btn" id="btn-org-pdf">+ Insert PDF</button>
        <button class="toolbar-btn active" id="btn-org-save">💾 Save PDF</button>
      </div>
      
      <div class="toolbar-section" id="search-toolbar-section">
        <div class="search-box" id="search-box">
          <input type="text" class="search-input" id="search-input" placeholder="Search text...">
          <button class="search-nav-btn" id="btn-search-prev" title="Previous match">▲</button>
          <button class="search-nav-btn" id="btn-search-next" title="Next match">▼</button>
        </div>
      </div>
    </div>
    
    <div class="main-workspace" id="main-workspace" style="display: none;">
      <div class="sidebar" id="sidebar">
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
        <div class="pdf-viewer" id="pdf-viewer"></div>
      </div>
    </div>
    
    <div class="welcome-screen" id="welcome-screen">
      <div class="welcome-logo">pdfication</div>
      <div class="welcome-subtitle">A Premium desktop PDF viewer powered by Wails</div>
      
      <div class="dropzone" id="dropzone">
        <div class="dropzone-icon">📥</div>
        <div class="dropzone-text">Drag & drop your PDF file here</div>
        <div class="dropzone-subtext">or click to browse local files</div>
      </div>
      
      <div class="recent-section" id="recent-section" style="display: none;">
        <div class="recent-title">Recent Files</div>
        <div class="recent-list" id="recent-list"></div>
      </div>
    </div>
    
    <div class="modal-overlay" id="password-modal">
      <div class="modal-card">
        <div class="modal-title">Password Required</div>
        <div class="modal-desc" id="password-modal-desc">This PDF document is encrypted. Please enter the password.</div>
        <input type="password" class="modal-input" id="password-input" placeholder="Password">
        <div class="modal-error" id="password-error">Incorrect password. Please try again.</div>
        <div class="modal-actions">
          <button class="toolbar-btn" id="password-cancel-btn">Cancel</button>
          <button class="toolbar-btn active" id="password-submit-btn">Submit</button>
        </div>
      </div>
    </div>
  `;
}

function cacheDOM() {
  welcomeScreen = document.getElementById('welcome-screen')!;
  tabContainer = document.getElementById('tab-bar')!;
  toolBar = document.getElementById('tool-bar')!;
  mainWorkspace = document.getElementById('main-workspace')!;
  viewerContainer = document.getElementById('viewer-container')!;
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
}

function bindEvents() {
  // Sidebar tabs toggle
  const pagesBtn = document.getElementById('tab-thumbnails-btn')!;
  const searchBtn = document.getElementById('tab-search-btn')!;
  pagesBtn.addEventListener('click', () => {
    pagesBtn.classList.add('active');
    searchBtn.classList.remove('active');
    thumbnailContainer.style.display = 'flex';
    searchResultsContainer.style.display = 'none';
  });
  searchBtn.addEventListener('click', () => {
    searchBtn.classList.add('active');
    pagesBtn.classList.remove('active');
    thumbnailContainer.style.display = 'none';
    searchResultsContainer.style.display = 'flex';
  });

  // Toggle sidebar
  document.getElementById('btn-toggle-sidebar')!.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
  });

  // Open file dialog buttons
  document.getElementById('btn-open-dialog')!.addEventListener('click', triggerSelectPDF);
  document.getElementById('add-tab-btn')!.addEventListener('click', triggerSelectPDF);
  document.getElementById('dropzone')!.addEventListener('click', triggerSelectPDF);

  // Organize Mode toggle button
  btnToggleOrganize.addEventListener('click', toggleOrganizeMode);

  // Organize Actions
  document.getElementById('btn-org-blank')!.addEventListener('click', insertBlankPage);
  document.getElementById('btn-org-pdf')!.addEventListener('click', insertOtherPDF);
  document.getElementById('btn-org-save')!.addEventListener('click', exportPDFDocument);

  // Drag and Drop handlers
  const dropzone = document.getElementById('dropzone')!;
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer?.files) {
      handleFiles(e.dataTransfer.files);
    }
  });

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
      const activeTab = getActiveTab();
      if (activeTab && pageNum >= 1 && pageNum <= activeTab.pages.length) {
        scrollToPage(pageNum);
      } else {
        updateToolbarPageInput();
      }
    }
  });

  // Rotation
  document.getElementById('btn-rotate-ccw')!.addEventListener('click', () => rotateDoc(-90));
  document.getElementById('btn-rotate-cw')!.addEventListener('click', () => rotateDoc(90));

  // Search
  searchInput.addEventListener('input', () => {
    performSearch(searchInput.value);
  });
  document.getElementById('btn-search-prev')!.addEventListener('click', () => navigateSearchMatch(-1));
  document.getElementById('btn-search-next')!.addEventListener('click', () => navigateSearchMatch(1));

  // Password Modal
  document.getElementById('password-submit-btn')!.addEventListener('click', () => {
    const input = document.getElementById('password-input') as HTMLInputElement;
    const modal = document.getElementById('password-modal')!;
    if (passwordResolver) {
      passwordResolver(input.value);
      passwordResolver = null;
      modal.classList.remove('show');
    }
  });
  document.getElementById('password-cancel-btn')!.addEventListener('click', () => {
    const modal = document.getElementById('password-modal')!;
    if (passwordResolver) {
      passwordResolver(null);
      passwordResolver = null;
      modal.classList.remove('show');
    }
  });
}

// Viewer Scrolling and Lazy Loading
const intersectionObserver = new IntersectionObserver((entries) => {
  if (isOrganizeMode) return; // ignore scrolling triggers in grid mode
  
  entries.forEach(entry => {
    const pageNum = parseInt(entry.target.getAttribute('data-page-number') || '0');
    if (pageNum === 0) return;

    if (entry.isIntersecting) {
      visiblePages.add(pageNum);
      renderPage(pageNum);
    } else {
      visiblePages.delete(pageNum);
    }
  });

  // Calculate current active page using the visiblePages set (top-most visible page)
  if (visiblePages.size > 0) {
    const minPage = Math.min(...Array.from(visiblePages));
    const activeTab = getActiveTab();
    if (activeTab && activeTab.currentPage !== minPage) {
      activeTab.currentPage = minPage;
      updateToolbarPageInput();
      updateActiveThumbnail();
    }
  }
}, {
  root: viewerContainer,
  rootMargin: '200px 0px' // pre-render adjacent pages
});

// Load Document Pipeline
async function triggerSelectPDF() {
  try {
    const result = await SelectAndReadPDF();
    if (result && result.data) {
      const arrayBuffer = toArrayBuffer(result.data);
      await loadPDFDocument(result.name, arrayBuffer, result.path);
    }
  } catch (err) {
    console.error('Failed to open PDF selection:', err);
  }
}

function handleFiles(files: FileList) {
  if (files.length === 0) return;
  const file = files[0];
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    alert('Please select a PDF file.');
    return;
  }
  const reader = new FileReader();
  reader.onload = async (e) => {
    const arrayBuffer = e.target?.result as ArrayBuffer;
    await loadPDFDocument(file.name, arrayBuffer);
  };
  reader.readAsArrayBuffer(file);
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

function promptPassword(filename: string, showIncorrectError: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    passwordResolver = resolve;
    const modal = document.getElementById('password-modal')!;
    const desc = document.getElementById('password-modal-desc')!;
    const input = document.getElementById('password-input') as HTMLInputElement;
    const errorEl = document.getElementById('password-error')!;

    desc.innerText = `Enter password for "${filename}":`;
    input.value = '';
    errorEl.style.display = showIncorrectError ? 'block' : 'none';

    modal.classList.add('show');
    input.focus();
  });
}

// Tabs Management
function createTab(name: string, arrayBuffer: ArrayBuffer, pdfDoc: pdfjsLib.PDFDocumentProxy, path?: string) {
  const id = `${name}-${Date.now()}`;
  
  // Initialize sequence list mapping
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
    pages
  };

  tabs.push(newTab);
  
  // Background text extraction for search
  const textCache: string[] = [];
  textCaches.set(id, textCache);
  extractText(pdfDoc, textCache);

  renderTabs();
  switchTab(id);
}

async function extractText(pdfDoc: pdfjsLib.PDFDocumentProxy, cache: string[]) {
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    try {
      const page = await pdfDoc.getPage(i);
      const textContent = await page.getTextContent();
      cache[i] = textContent.items.map((item: any) => item.str).join(' ');
    } catch (e) {
      console.error(`Error caching text on page ${i}:`, e);
    }
  }
}

function renderTabs() {
  const tabElements = tabContainer.querySelectorAll('.pdf-tab');
  tabElements.forEach(el => el.remove());

  const addBtn = document.getElementById('add-tab-btn')!;

  tabs.forEach(tab => {
    const tabEl = document.createElement('div');
    tabEl.className = `pdf-tab ${tab.id === activeTabId ? 'active' : ''}`;
    tabEl.setAttribute('data-tab-id', tab.id);
    
    const titleEl = document.createElement('span');
    titleEl.className = 'tab-title';
    titleEl.innerText = tab.name;
    titleEl.addEventListener('click', () => switchTab(tab.id));

    const closeEl = document.createElement('span');
    closeEl.className = 'tab-close';
    closeEl.innerHTML = '✕';
    closeEl.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });

    tabEl.appendChild(titleEl);
    tabEl.appendChild(closeEl);
    tabContainer.insertBefore(tabEl, addBtn);
  });
}

function switchTab(id: string) {
  activeTabId = id;
  const tab = getActiveTab();
  if (!tab) return;

  // Force Exit Organize Mode when switching tabs
  isOrganizeMode = false;
  btnToggleOrganize.classList.remove('active');
  standardToolbarActions.style.display = 'flex';
  organizeToolbarActions.style.display = 'none';
  document.getElementById('search-toolbar-section')!.style.display = 'flex';
  pdfViewer.className = 'pdf-viewer';

  renderTabs();
  
  // Reset scroll and render lists
  renderedPages.clear();
  visiblePages.clear();
  pdfViewer.innerHTML = '';
  
  // Show UI elements
  welcomeScreen.style.display = 'none';
  toolBar.style.display = 'flex';
  mainWorkspace.style.display = 'flex';

  // Create page wrappers mapping pages sequence
  for (let i = 1; i <= tab.pages.length; i++) {
    const wrapper = document.createElement('div');
    wrapper.className = 'page-wrapper';
    wrapper.setAttribute('data-page-number', i.toString());
    
    // Initial size estimate
    wrapper.style.width = '612px';
    wrapper.style.height = '792px';
    wrapper.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">Loading...</div>`;
    
    pdfViewer.appendChild(wrapper);
    intersectionObserver.observe(wrapper);
  }

  // Restore toolbar state
  zoomInput.value = Math.round(tab.zoom * 100) + '%';
  pageNavTotal.innerText = `/ ${tab.pages.length}`;
  searchInput.value = tab.searchQuery;
  updateToolbarPageInput();

  // Lazy render thumbnails list
  renderThumbnails(tab);

  // Perform search UI update
  renderSearchResults();

  // Resize pages initially
  updateDocLayout();
}

function closeTab(id: string) {
  const index = tabs.findIndex(t => t.id === id);
  if (index === -1) return;

  tabs.splice(index, 1);
  textCaches.delete(id);

  if (activeTabId === id) {
    if (tabs.length > 0) {
      switchTab(tabs[Math.max(0, index - 1)].id);
    } else {
      activeTabId = null;
      isOrganizeMode = false;
      // Show landing
      welcomeScreen.style.display = 'flex';
      toolBar.style.display = 'none';
      mainWorkspace.style.display = 'none';
      renderRecentFiles();
    }
  } else {
    renderTabs();
  }
}

// Page Rendering logic (Mapped to tab.pages sequence)
async function renderPage(pageNum: number) {
  const tab = getActiveTab();
  if (!tab || renderedPages.has(pageNum) || isOrganizeMode) return;

  const wrapper = document.querySelector(`.page-wrapper[data-page-number="${pageNum}"]`) as HTMLElement;
  if (!wrapper) return;

  renderedPages.add(pageNum);

  const pageItem = tab.pages[pageNum - 1];
  if (!pageItem) return;

  if (pageItem.isBlank) {
    // Render blank A4 page placeholder
    const width = 612 * tab.zoom;
    const height = 792 * tab.zoom;
    wrapper.style.width = `${width}px`;
    wrapper.style.height = `${height}px`;
    wrapper.style.backgroundColor = 'white';
    wrapper.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#94a3b8;font-family:sans-serif;user-select:none;">
        <span style="font-size:24px;font-weight:bold;margin-bottom:8px;">Blank Page</span>
        <span style="font-size:13px;">Inserted Space</span>
      </div>
    `;
    return;
  }

  wrapper.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">Rendering...</div>`;

  try {
    const srcTab = tabs.find(t => t.id === pageItem.docId) || tab;
    const page = await srcTab.pdfDoc.getPage(pageItem.originalPageNum);
    const finalRotation = (tab.rotation + pageItem.rotation) % 360;
    const viewport = page.getViewport({ scale: tab.zoom, rotation: finalRotation });

    wrapper.style.width = `${viewport.width}px`;
    wrapper.style.height = `${viewport.height}px`;
    wrapper.innerHTML = '';

    // Canvas rendering
    const canvas = document.createElement('canvas');
    canvas.className = 'page-canvas';
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    wrapper.appendChild(canvas);

    await page.render({
      canvas: canvas,
      viewport: viewport
    }).promise;

    // Text selection layer
    const textContent = await page.getTextContent();
    const textLayerDiv = document.createElement('div');
    textLayerDiv.className = 'textLayer';
    wrapper.appendChild(textLayerDiv);

    const textLayer = new pdfjsLib.TextLayer({
      textContentSource: textContent,
      container: textLayerDiv,
      viewport: viewport
    });
    
    await textLayer.render();
    
    // Highlight if search query is active
    if (tab.searchQuery) {
      highlightTextOnPage(pageNum, tab.searchQuery);
    }
  } catch (err) {
    console.error(`Page ${pageNum} render failed:`, err);
    renderedPages.delete(pageNum);
  }
}

// Update sizes of placeholders when Zoom or Rotation changes
async function updateDocLayout() {
  const tab = getActiveTab();
  if (!tab || isOrganizeMode) return;

  renderedPages.clear();
  
  try {
    let width = 612 * tab.zoom;
    let height = 792 * tab.zoom;
    
    // Get viewport parameters of first non-blank page to align layout correctly
    const samplePage = tab.pages.find(p => !p.isBlank);
    if (samplePage) {
      const srcTab = tabs.find(t => t.id === samplePage.docId) || tab;
      const page = await srcTab.pdfDoc.getPage(samplePage.originalPageNum);
      const finalRotation = (tab.rotation + samplePage.rotation) % 360;
      const vp = page.getViewport({ scale: tab.zoom, rotation: finalRotation });
      width = vp.width;
      height = vp.height;
    }

    const wrappers = document.querySelectorAll('.page-wrapper');
    wrappers.forEach(el => {
      const w = el as HTMLElement;
      w.style.width = `${width}px`;
      w.style.height = `${height}px`;
      w.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">Scroll to load</div>`;
    });

    visiblePages.forEach(p => renderPage(p));
  } catch (e) {
    console.error('Layout update failed:', e);
  }
}

// Thumbnails Sidebar List
async function renderThumbnails(tab: PDFTab) {
  thumbnailContainer.innerHTML = '';

  tab.pages.forEach((pageItem, i) => {
    const pageNum = i + 1;
    const wrapper = document.createElement('div');
    wrapper.className = `thumbnail-wrapper ${pageNum === tab.currentPage ? 'active' : ''}`;
    wrapper.setAttribute('data-page-number', pageNum.toString());
    wrapper.addEventListener('click', () => scrollToPage(pageNum));

    const box = document.createElement('div');
    box.className = 'thumbnail-box';
    box.style.width = '120px';
    box.style.height = '160px'; // default box ratio

    const label = document.createElement('div');
    label.className = 'thumbnail-label';
    label.innerText = pageNum.toString();

    wrapper.appendChild(box);
    wrapper.appendChild(label);
    thumbnailContainer.appendChild(wrapper);

    // Render thumbnail canvas or blank icon
    if (pageItem.isBlank) {
      box.style.backgroundColor = 'white';
      box.style.width = '120px';
      box.style.height = '160px';
      box.innerHTML = '<span style="color:#64748b;font-size:10px;font-weight:bold;display:flex;align-items:center;justify-content:center;height:100%;">BLANK</span>';
    } else {
      const srcTab = tabs.find(t => t.id === pageItem.docId) || tab;
      renderThumbnailCanvas(srcTab.pdfDoc, pageItem.originalPageNum, pageItem.rotation, box);
    }
  });
}

async function renderThumbnailCanvas(pdfDoc: pdfjsLib.PDFDocumentProxy, pageNum: number, rotation: number, container: HTMLElement) {
  try {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 0.15, rotation });

    container.style.width = `${viewport.width}px`;
    container.style.height = `${viewport.height}px`;

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    await page.render({
      canvas: canvas,
      viewport: viewport
    }).promise;

    container.innerHTML = '';
    container.appendChild(canvas);
  } catch (e) {
    console.error(`Thumbnail canvas failed at page ${pageNum}:`, e);
  }
}

function updateActiveThumbnail() {
  const tab = getActiveTab();
  if (!tab) return;

  const thumbs = thumbnailContainer.querySelectorAll('.thumbnail-wrapper');
  thumbs.forEach(el => {
    const pNum = parseInt(el.getAttribute('data-page-number') || '1');
    if (pNum === tab.currentPage) {
      el.classList.add('active');
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      el.classList.remove('active');
    }
  });
}

// Navigation & Actions
function getActiveTab(): PDFTab | null {
  return tabs.find(t => t.id === activeTabId) || null;
}

function scrollToPage(pageNum: number) {
  const el = document.querySelector(`.page-wrapper[data-page-number="${pageNum}"]`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth' });
  }
}

function navigatePage(direction: number) {
  const tab = getActiveTab();
  if (!tab) return;
  const target = tab.currentPage + direction;
  if (target >= 1 && target <= tab.pages.length) {
    scrollToPage(target);
  }
}

function updateToolbarPageInput() {
  const tab = getActiveTab();
  if (tab) {
    pageNavInput.value = tab.currentPage.toString();
  }
}

function adjustZoom(diff: number) {
  const tab = getActiveTab();
  if (!tab) return;
  const newZoom = Math.max(0.5, Math.min(3.0, tab.zoom + diff));
  setZoom(newZoom);
}

function setZoom(val: number) {
  const tab = getActiveTab();
  if (!tab) return;
  tab.zoom = val;
  zoomInput.value = Math.round(val * 100) + '%';
  updateDocLayout();
}

function rotateDoc(angle: number) {
  const tab = getActiveTab();
  if (!tab) return;
  tab.rotation = (tab.rotation + angle + 360) % 360;
  updateDocLayout();
  // Reload thumbnails under new rotation
  renderThumbnails(tab);
}

// Text Search Implementation (Searches only original documents cached text)
function performSearch(query: string) {
  const tab = getActiveTab();
  if (!tab) return;

  tab.searchQuery = query;
  tab.searchResults = [];
  tab.currentMatchIndex = -1;

  if (!query) {
    renderSearchResults();
    clearAllHighlights();
    return;
  }

  const results: SearchMatch[] = [];
  const lowerQuery = query.toLowerCase();

  // Search through all segments sequence mapping
  tab.pages.forEach((pageItem, index) => {
    if (pageItem.isBlank) return;
    
    const cache = textCaches.get(pageItem.docId);
    if (!cache) return;
    
    const text = cache[pageItem.originalPageNum];
    if (!text) return;

    let idx = text.toLowerCase().indexOf(lowerQuery);
    while (idx !== -1) {
      const start = Math.max(0, idx - 25);
      const end = Math.min(text.length, idx + query.length + 25);
      let snippet = text.substring(start, end);
      
      const highlightRegex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
      snippet = snippet.replace(highlightRegex, '<mark>$1</mark>');

      // pageNumber represents the 1-based sequence index in the active pages array
      results.push({
        pageNumber: index + 1,
        text: `...${snippet}...`,
        matchIndex: results.length
      });

      idx = text.toLowerCase().indexOf(lowerQuery, idx + 1);
    }
  });

  tab.searchResults = results;
  renderSearchResults();
  
  renderedPages.forEach(pageNum => {
    highlightTextOnPage(pageNum, query);
  });
}

function highlightTextOnPage(pageNum: number, query: string) {
  const layer = document.querySelector(`.page-wrapper[data-page-number="${pageNum}"] .textLayer`);
  if (!layer) return;

  const spans = layer.querySelectorAll('span');
  const lowerQuery = query.toLowerCase();

  spans.forEach(span => {
    if (!span.getAttribute('data-original-html')) {
      span.setAttribute('data-original-html', span.innerHTML);
    }

    const text = span.getAttribute('data-original-html') || span.innerText;
    if (lowerQuery && text.toLowerCase().includes(lowerQuery)) {
      const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
      span.innerHTML = text.replace(regex, '<mark class="highlight">$1</mark>');
    } else {
      span.innerHTML = text;
    }
  });
}

function clearAllHighlights() {
  const textLayers = document.querySelectorAll('.textLayer');
  textLayers.forEach(layer => {
    const spans = layer.querySelectorAll('span');
    spans.forEach(span => {
      const orig = span.getAttribute('data-original-html');
      if (orig) {
        span.innerHTML = orig;
        span.removeAttribute('data-original-html');
      }
    });
  });
}

function renderSearchResults() {
  const tab = getActiveTab();
  if (!tab || !tab.searchQuery) {
    searchResultsContainer.innerHTML = '<div class="search-no-results">No query entered</div>';
    return;
  }

  if (tab.searchResults.length === 0) {
    searchResultsContainer.innerHTML = '<div class="search-no-results">No matches found</div>';
    return;
  }

  searchResultsContainer.innerHTML = '';
  tab.searchResults.forEach((match, idx) => {
    const item = document.createElement('div');
    item.className = `search-result-item ${idx === tab.currentMatchIndex ? 'active' : ''}`;
    item.setAttribute('data-match-index', idx.toString());
    item.addEventListener('click', () => selectSearchMatch(idx));

    const header = document.createElement('div');
    header.className = 'search-result-header';
    header.innerHTML = `<span>Page ${match.pageNumber}</span><span>#${idx + 1}</span>`;

    const text = document.createElement('div');
    text.className = 'search-result-text';
    text.innerHTML = match.text;

    item.appendChild(header);
    item.appendChild(text);
    searchResultsContainer.appendChild(item);
  });
}

function selectSearchMatch(idx: number) {
  const tab = getActiveTab();
  if (!tab || idx < 0 || idx >= tab.searchResults.length) return;

  tab.currentMatchIndex = idx;
  const match = tab.searchResults[idx];

  const items = searchResultsContainer.querySelectorAll('.search-result-item');
  items.forEach(el => {
    const matchIdx = parseInt(el.getAttribute('data-match-index') || '-1');
    if (matchIdx === idx) {
      el.classList.add('active');
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      el.classList.remove('active');
    }
  });

  scrollToPage(match.pageNumber);
  
  setTimeout(() => {
    document.querySelectorAll('.textLayer .highlight.selected').forEach(mark => {
      mark.classList.remove('selected');
    });

    const pageWrapper = document.querySelector(`.page-wrapper[data-page-number="${match.pageNumber}"]`);
    if (pageWrapper) {
      const firstHighlight = pageWrapper.querySelector('.textLayer .highlight');
      if (firstHighlight) {
        firstHighlight.classList.add('selected');
        firstHighlight.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  }, 350);
}

function navigateSearchMatch(dir: number) {
  const tab = getActiveTab();
  if (!tab || tab.searchResults.length === 0) return;

  let newIdx = tab.currentMatchIndex + dir;
  if (newIdx < 0) newIdx = tab.searchResults.length - 1;
  if (newIdx >= tab.searchResults.length) newIdx = 0;

  selectSearchMatch(newIdx);
}

// Organize Mode Sorter Page View Layout and Handlers
function toggleOrganizeMode() {
  const tab = getActiveTab();
  if (!tab) return;

  isOrganizeMode = !isOrganizeMode;

  if (isOrganizeMode) {
    btnToggleOrganize.classList.add('active');
    standardToolbarActions.style.display = 'none';
    organizeToolbarActions.style.display = 'flex';
    document.getElementById('search-toolbar-section')!.style.display = 'none';

    pdfViewer.className = 'organize-grid';
    renderOrganizeGrid();
  } else {
    btnToggleOrganize.classList.remove('active');
    standardToolbarActions.style.display = 'flex';
    organizeToolbarActions.style.display = 'none';
    document.getElementById('search-toolbar-section')!.style.display = 'flex';

    pdfViewer.className = 'pdf-viewer';
    switchTab(tab.id); // Reload reader mode
  }
}

function renderOrganizeGrid() {
  const tab = getActiveTab();
  if (!tab) return;

  pdfViewer.innerHTML = '';
  intersectionObserver.disconnect(); // stop checking scroll intersects

  tab.pages.forEach((pageItem, index) => {
    const card = document.createElement('div');
    card.className = 'organize-card';
    card.setAttribute('draggable', 'true');
    card.setAttribute('data-seq-index', index.toString());

    // Card Header (Actions)
    const header = document.createElement('div');
    header.className = 'organize-card-header';
    header.innerHTML = `
      <span>Page ${index + 1}</span>
      <div class="organize-card-actions">
        <button class="organize-action-btn" title="Rotate Page 90°" data-action="rotate">↻</button>
        <button class="organize-action-btn" title="Duplicate Page" data-action="duplicate">📄</button>
        <button class="organize-action-btn delete" title="Delete Page" data-action="delete">✕</button>
      </div>
    `;

    header.querySelector('[data-action="rotate"]')!.addEventListener('click', (e) => {
      e.stopPropagation();
      rotatePageItem(index);
    });
    header.querySelector('[data-action="duplicate"]')!.addEventListener('click', (e) => {
      e.stopPropagation();
      duplicatePageItem(index);
    });
    header.querySelector('[data-action="delete"]')!.addEventListener('click', (e) => {
      e.stopPropagation();
      deletePageItem(index);
    });

    // Card Body (Canvas)
    const body = document.createElement('div');
    body.className = 'organize-card-body';
    body.innerHTML = '<span style="color:var(--text-muted);font-size:11px;">Loading...</span>';

    // Card Source Label
    const label = document.createElement('div');
    label.className = 'organize-card-label';
    
    // Find the name of the source PDF tab
    const srcTab = tabs.find(t => t.id === pageItem.docId) || tab;
    label.innerText = pageItem.isBlank ? 'Blank Page' : srcTab.name;
    label.title = label.innerText;

    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(label);

    // Card Drag and Drop bindings
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragover', handleDragOver);
    card.addEventListener('dragleave', handleDragLeave);
    card.addEventListener('drop', handleDrop);
    card.addEventListener('dragend', handleDragEnd);

    pdfViewer.appendChild(card);

    // Async render page contents onto card body
    renderCardThumbnail(tab, pageItem, body);
  });
}

async function renderCardThumbnail(tab: PDFTab, pageItem: PageItem, container: HTMLElement) {
  if (pageItem.isBlank) {
    container.style.backgroundColor = 'white';
    container.innerHTML = '<span style="color:#64748b;font-size:11px;font-weight:bold;">BLANK</span>';
    return;
  }

  const srcTab = tabs.find(t => t.id === pageItem.docId) || tab;
  try {
    const page = await srcTab.pdfDoc.getPage(pageItem.originalPageNum);
    // Combine tab rotation and page-level rotation overrides
    const finalRotation = (tab.rotation + pageItem.rotation) % 360;
    const viewport = page.getViewport({ scale: 0.18, rotation: finalRotation });

    container.style.width = '120px';
    container.style.height = '160px';

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    canvas.style.maxWidth = '100%';
    canvas.style.maxHeight = '100%';
    canvas.style.objectFit = 'contain';

    await page.render({
      canvas: canvas,
      viewport: viewport
    }).promise;

    container.innerHTML = '';
    container.appendChild(canvas);
  } catch (err) {
    console.error('Thumbnail card render failed:', err);
    container.innerHTML = '<span style="color:#ef4444;font-size:10px;">Error</span>';
  }
}

// Sorter Card Actions
function rotatePageItem(index: number) {
  const tab = getActiveTab();
  if (!tab) return;
  tab.pages[index].rotation = (tab.pages[index].rotation + 90) % 360;
  renderOrganizeGrid();
}

function duplicatePageItem(index: number) {
  const tab = getActiveTab();
  if (!tab) return;

  const copy = { ...tab.pages[index] };
  copy.id = `${tab.id}-p${copy.originalPageNum}-${Date.now()}-${Math.random()}`;
  tab.pages.splice(index + 1, 0, copy);
  
  renderOrganizeGrid();
}

function deletePageItem(index: number) {
  const tab = getActiveTab();
  if (!tab) return;
  tab.pages.splice(index, 1);
  renderOrganizeGrid();
}

// Toolbar Sorter Actions
function insertBlankPage() {
  const tab = getActiveTab();
  if (!tab) return;

  tab.pages.push({
    id: `blank-${Date.now()}-${Math.random()}`,
    docId: 'blank',
    originalPageNum: 0,
    rotation: 0,
    isBlank: true
  });

  renderOrganizeGrid();
}

async function insertOtherPDF() {
  const tab = getActiveTab();
  if (!tab) return;

  try {
    const result = await SelectAndReadPDF();
    if (result && result.data) {
      const arrayBuffer = toArrayBuffer(result.data);
      const otherDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const otherTabId = `other-${Date.now()}-${Math.random()}`;

      // Cache other doc for reference rendering
      const otherTab: PDFTab = {
        id: otherTabId,
        name: result.name,
        path: result.path,
        pdfDoc: otherDoc,
        currentPage: 1,
        zoom: 1.0,
        rotation: 0,
        searchQuery: '',
        searchResults: [],
        currentMatchIndex: -1,
        arrayBuffer,
        pages: []
      };
      tabs.push(otherTab);

      const otherTextCache: string[] = [];
      textCaches.set(otherTabId, otherTextCache);
      extractText(otherDoc, otherTextCache);

      // Append pages from other doc
      for (let i = 1; i <= otherDoc.numPages; i++) {
        tab.pages.push({
          id: `${otherTabId}-p${i}-${Date.now()}-${Math.random()}`,
          docId: otherTabId,
          path: result.path,
          originalPageNum: i,
          rotation: 0,
          isBlank: false
        });
      }

      renderOrganizeGrid();
    }
  } catch (err) {
    alert(`Failed to insert pages: ${err}`);
  }
}

async function exportPDFDocument() {
  const tab = getActiveTab();
  if (!tab || tab.pages.length === 0) return;

  try {
    const defaultName = tab.name.toLowerCase().endsWith('.pdf') 
      ? tab.name.slice(0, -4) + '_modified.pdf' 
      : tab.name + '_modified.pdf';
      
    const savePath = await SelectSavePath(defaultName);
    if (!savePath) return; // User cancelled

    // Format PageSpec sequence mapped by backend definitions
    const sequenceList = tab.pages.map(pageItem => {
      let pagePath = '';
      if (!pageItem.isBlank) {
        const srcTab = tabs.find(t => t.id === pageItem.docId) || tab;
        pagePath = srcTab.path || '';
      }
      return {
        path: pagePath,
        pageNumber: pageItem.originalPageNum,
        rotation: pageItem.rotation,
        isBlank: pageItem.isBlank
      };
    });

    await ExportPDF(sequenceList, savePath);
    alert('PDF file exported successfully!');
  } catch (err: any) {
    alert(`Failed to save PDF document: ${err.message || err}`);
  }
}

// Drag Events
function handleDragStart(e: DragEvent) {
  const target = e.currentTarget as HTMLElement;
  dragSrcIndex = parseInt(target.getAttribute('data-seq-index') || '0');
  target.classList.add('dragging');
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragSrcIndex.toString());
  }
}

function handleDragOver(e: DragEvent) {
  e.preventDefault();
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move';
  }
  const target = e.currentTarget as HTMLElement;
  target.classList.add('drag-over');
}

function handleDragLeave(e: DragEvent) {
  const target = e.currentTarget as HTMLElement;
  target.classList.remove('drag-over');
}

function handleDragEnd(e: DragEvent) {
  const target = e.currentTarget as HTMLElement;
  target.classList.remove('dragging');
  document.querySelectorAll('.organize-card').forEach(el => el.classList.remove('drag-over'));
}

function handleDrop(e: DragEvent) {
  e.preventDefault();
  const target = e.currentTarget as HTMLElement;
  target.classList.remove('drag-over');

  const destIndex = parseInt(target.getAttribute('data-seq-index') || '0');
  if (dragSrcIndex === null || dragSrcIndex === destIndex) return;

  const tab = getActiveTab();
  if (!tab) return;

  // Move page element inside the tab pages array
  const movingItem = tab.pages.splice(dragSrcIndex, 1)[0];
  tab.pages.splice(destIndex, 0, movingItem);

  dragSrcIndex = null;
  renderOrganizeGrid();
}

// Recent Files Management
function renderRecentFiles() {
  const recents: RecentFile[] = JSON.parse(localStorage.getItem('recentFiles') || '[]');
  if (recents.length === 0) {
    recentSection.style.display = 'none';
    return;
  }

  recentSection.style.display = 'flex';
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

// Helpers
function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

function toArrayBuffer(data: any): ArrayBuffer {
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
  throw new Error('Unsupported data format');
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
