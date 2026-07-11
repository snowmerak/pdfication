import * as pdfjsLib from 'pdfjs-dist';
import { 
  getActiveTab, 
  tabs, 
  isOrganizeMode, 
  isToolboxMode, 
  renderedPages, 
  visiblePages, 
  textCaches, 
  escapeRegExp,
  SearchMatch
} from './state';

// Page change event hooks
let onPageChangedCallback: (() => void) | null = null;
export function registerOnPageChanged(cb: () => void) {
  onPageChangedCallback = cb;
}

// Viewer Scrolling and Lazy Loading
export const intersectionObserver = new IntersectionObserver((entries) => {
  if (isOrganizeMode || isToolboxMode) return;
  
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

  if (visiblePages.size > 0) {
    const minPage = Math.min(...Array.from(visiblePages));
    const activeTab = getActiveTab();
    if (activeTab && activeTab.currentPage !== minPage) {
      activeTab.currentPage = minPage;
      if (onPageChangedCallback) onPageChangedCallback();
    }
  }
}, {
  root: document.getElementById('viewer-container'),
  rootMargin: '200px 0px'
});

// Page Rendering logic
export async function renderPage(pageNum: number) {
  const tab = getActiveTab();
  if (!tab || renderedPages.has(pageNum) || isOrganizeMode || isToolboxMode) return;

  const wrapper = document.querySelector(`.page-wrapper[data-page-number="${pageNum}"]`) as HTMLElement;
  if (!wrapper) return;

  renderedPages.add(pageNum);

  const pageItem = tab.pages[pageNum - 1];
  if (!pageItem) return;

  if (pageItem.isBlank) {
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

    const canvas = document.createElement('canvas');
    canvas.className = 'page-canvas';
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    wrapper.appendChild(canvas);

    await page.render({
      canvas: canvas,
      viewport: viewport
    }).promise;

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
    
    if (tab.searchQuery) {
      highlightTextOnPage(pageNum, tab.searchQuery);
    }
  } catch (err) {
    console.error(`Page ${pageNum} render failed:`, err);
    renderedPages.delete(pageNum);
  }
}

export async function updateDocLayout() {
  const tab = getActiveTab();
  if (!tab || isOrganizeMode || isToolboxMode) return;

  renderedPages.clear();
  
  try {
    let width = 612 * tab.zoom;
    let height = 792 * tab.zoom;
    
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

// Text Search logic
export function performSearch(query: string) {
  const tab = getActiveTab();
  if (!tab) return;

  tab.searchQuery = query;
  tab.searchResults = [];
  tab.currentMatchIndex = -1;

  const searchResultsContainer = document.getElementById('sidebar-search-results')!;

  if (!query) {
    searchResultsContainer.innerHTML = '<div class="search-no-results">No query entered</div>';
    clearAllHighlights();
    return;
  }

  const results: SearchMatch[] = [];
  const lowerQuery = query.toLowerCase();

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

      results.push({
        pageNumber: index + 1,
        text: `...${snippet}...`,
        matchIndex: results.length
      });

      idx = text.toLowerCase().indexOf(lowerQuery, idx + 1);
    }
  });

  tab.searchResults = results;
  
  // Trigger redraw of results list in main UI
  if (onPageChangedCallback) onPageChangedCallback();
  
  renderedPages.forEach(pageNum => {
    highlightTextOnPage(pageNum, query);
  });
}

export function highlightTextOnPage(pageNum: number, query: string) {
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

export function clearAllHighlights() {
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
