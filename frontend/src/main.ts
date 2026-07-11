import './style.css';
import './app.css';

import { SelectAndReadPDF, ReadPDFFile } from '../wailsjs/go/main/App';
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDFJS worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

// Typings
interface PDFTab {
  id: string;
  name: string;
  path?: string;
  pdfDoc: pdfjsLib.PDFDocumentProxy;
  currentPage: number;
  zoom: number;
  rotation: number; // 0, 90, 180, 270
  searchQuery: string;
  searchResults: SearchMatch[];
  currentMatchIndex: number;
  arrayBuffer: ArrayBuffer;
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
let zoomSelect!: HTMLSelectElement;
let searchInput!: HTMLInputElement;
let recentList!: HTMLElement;
let recentSection!: HTMLElement;

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
      </div>
      
      <div class="toolbar-section">
        <button class="toolbar-btn icon-only" id="btn-zoom-out" title="Zoom Out">-</button>
        <select class="zoom-select" id="zoom-select">
          <option value="0.5">50%</option>
          <option value="0.75">75%</option>
          <option value="1.0" selected>100%</option>
          <option value="1.25">125%</option>
          <option value="1.5">150%</option>
          <option value="2.0">200%</option>
          <option value="3.0">300%</option>
        </select>
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
      
      <div class="toolbar-section">
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
  zoomSelect = document.getElementById('zoom-select') as HTMLSelectElement;
  searchInput = document.getElementById('search-input') as HTMLInputElement;
  recentList = document.getElementById('recent-list')!;
  recentSection = document.getElementById('recent-section')!;
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
  zoomSelect.addEventListener('change', () => {
    const val = parseFloat(zoomSelect.value);
    setZoom(val);
  });

  // Navigation
  document.getElementById('btn-prev-page')!.addEventListener('click', () => navigatePage(-1));
  document.getElementById('btn-next-page')!.addEventListener('click', () => navigatePage(1));
  pageNavInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const pageNum = parseInt(pageNavInput.value);
      const activeTab = getActiveTab();
      if (activeTab && pageNum >= 1 && pageNum <= activeTab.pdfDoc.numPages) {
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

  // Scroll visibility rendering
  viewerContainer.addEventListener('scroll', handleViewerScroll);

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
}, {
  root: viewerContainer,
  rootMargin: '200px 0px' // pre-render adjacent pages
});

function handleViewerScroll() {
  const activeTab = getActiveTab();
  if (!activeTab) return;

  const pageElements = document.querySelectorAll('.page-wrapper');
  let closestPage = activeTab.currentPage;
  let minDiff = Infinity;
  const containerRect = viewerContainer.getBoundingClientRect();

  pageElements.forEach(el => {
    const rect = el.getBoundingClientRect();
    const diff = Math.abs(rect.top - containerRect.top);
    if (diff < minDiff) {
      minDiff = diff;
      closestPage = parseInt(el.getAttribute('data-page-number') || '1');
    }
  });

  if (activeTab.currentPage !== closestPage) {
    activeTab.currentPage = closestPage;
    updateToolbarPageInput();
    updateActiveThumbnail();
  }
}

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
    arrayBuffer
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
  // Clear non-add-button children
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

  renderTabs();
  
  // Reset scroll and render lists
  renderedPages.clear();
  visiblePages.clear();
  pdfViewer.innerHTML = '';
  
  // Show UI elements
  welcomeScreen.style.display = 'none';
  toolBar.style.display = 'flex';
  mainWorkspace.style.display = 'flex';

  // Create page wrappers
  for (let i = 1; i <= tab.pdfDoc.numPages; i++) {
    const wrapper = document.createElement('div');
    wrapper.className = 'page-wrapper';
    wrapper.setAttribute('data-page-number', i.toString());
    
    // Initial size estimate before loading actual viewports to prevent layout shifting
    wrapper.style.width = '612px'; // standard US Letter width at scale 1.0
    wrapper.style.height = '792px'; // standard US Letter height at scale 1.0
    wrapper.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">Loading...</div>`;
    
    pdfViewer.appendChild(wrapper);
    intersectionObserver.observe(wrapper);
  }

  // Restore toolbar state
  zoomSelect.value = tab.zoom.toString();
  pageNavTotal.innerText = `/ ${tab.pdfDoc.numPages}`;
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

// Page Rendering logic
async function renderPage(pageNum: number) {
  const tab = getActiveTab();
  if (!tab || renderedPages.has(pageNum)) return;

  const wrapper = document.querySelector(`.page-wrapper[data-page-number="${pageNum}"]`) as HTMLElement;
  if (!wrapper) return;

  renderedPages.add(pageNum);
  wrapper.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">Rendering...</div>`;

  try {
    const page = await tab.pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: tab.zoom, rotation: tab.rotation });

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
  if (!tab) return;

  renderedPages.clear();
  
  try {
    const page = await tab.pdfDoc.getPage(1);
    const viewport = page.getViewport({ scale: tab.zoom, rotation: tab.rotation });

    const wrappers = document.querySelectorAll('.page-wrapper');
    wrappers.forEach(el => {
      const w = el as HTMLElement;
      w.style.width = `${viewport.width}px`;
      w.style.height = `${viewport.height}px`;
      w.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">Scroll to load</div>`;
    });

    // Re-render visible ones
    visiblePages.forEach(p => renderPage(p));
    // Trigger scroll check to kick start adjacent load
    handleViewerScroll();
  } catch (e) {
    console.error('Layout update failed:', e);
  }
}

// Thumbnails Sidebar List
async function renderThumbnails(tab: PDFTab) {
  thumbnailContainer.innerHTML = '';

  for (let i = 1; i <= tab.pdfDoc.numPages; i++) {
    const wrapper = document.createElement('div');
    wrapper.className = `thumbnail-wrapper ${i === tab.currentPage ? 'active' : ''}`;
    wrapper.setAttribute('data-page-number', i.toString());
    wrapper.addEventListener('click', () => scrollToPage(i));

    const box = document.createElement('div');
    box.className = 'thumbnail-box';
    box.style.width = '120px';
    box.style.height = '160px'; // default box ratio

    const label = document.createElement('div');
    label.className = 'thumbnail-label';
    label.innerText = i.toString();

    wrapper.appendChild(box);
    wrapper.appendChild(label);
    thumbnailContainer.appendChild(wrapper);

    // Lazy load the small thumbnail canvas asynchronously
    renderThumbnailCanvas(tab.pdfDoc, i, box);
  }
}

async function renderThumbnailCanvas(pdfDoc: pdfjsLib.PDFDocumentProxy, pageNum: number, container: HTMLElement) {
  try {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 0.15 });

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
      // Scroll sidebar into view if needed
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
  if (target >= 1 && target <= tab.pdfDoc.numPages) {
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
  zoomSelect.value = val.toString();
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

// Text Search Implementation
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

  const cache = textCaches.get(tab.id);
  if (!cache) return;

  const results: SearchMatch[] = [];
  const lowerQuery = query.toLowerCase();

  for (let pageNum = 1; pageNum < cache.length; pageNum++) {
    const text = cache[pageNum];
    if (!text) continue;

    let index = text.toLowerCase().indexOf(lowerQuery);
    while (index !== -1) {
      const start = Math.max(0, index - 25);
      const end = Math.min(text.length, index + query.length + 25);
      let snippet = text.substring(start, end);
      
      // Highlight exact match in snippet
      const highlightRegex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
      snippet = snippet.replace(highlightRegex, '<mark>$1</mark>');

      results.push({
        pageNumber: pageNum,
        text: `...${snippet}...`,
        matchIndex: results.length
      });

      index = text.toLowerCase().indexOf(lowerQuery, index + 1);
    }
  }

  tab.searchResults = results;
  renderSearchResults();
  
  // Re-apply highlights to currently rendered pages
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

  // Update sidebar active highlights
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
  
  // Mark search hit as selected in page text layer
  setTimeout(() => {
    // Clear all previously selected active highlights
    document.querySelectorAll('.textLayer .highlight.selected').forEach(mark => {
      mark.classList.remove('selected');
    });

    const pageWrapper = document.querySelector(`.page-wrapper[data-page-number="${match.pageNumber}"]`);
    if (pageWrapper) {
      // Find the highlights on that page and mark the first one as selected for visual feedback
      const firstHighlight = pageWrapper.querySelector('.textLayer .highlight');
      if (firstHighlight) {
        firstHighlight.classList.add('selected');
        firstHighlight.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  }, 350); // wait for smooth scroll to finish
}

function navigateSearchMatch(dir: number) {
  const tab = getActiveTab();
  if (!tab || tab.searchResults.length === 0) return;

  let newIdx = tab.currentMatchIndex + dir;
  if (newIdx < 0) newIdx = tab.searchResults.length - 1;
  if (newIdx >= tab.searchResults.length) newIdx = 0;

  selectSearchMatch(newIdx);
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

