import * as pdfjsLib from 'pdfjs-dist';
import { 
  SelectAndReadPDF, 
  SelectSavePath, 
  ExportPDF,
  SelectMultipleImages,
  ImagesToPDF,
  SaveTempFile,
  ReadPDFFile,
  SelectDirectory,
  SaveImagePage
} from '../wailsjs/go/main/App';
import { 
  PageItem, 
  PDFTab, 
  tabs, 
  getActiveTab, 
  pushHistory, 
  selectedPageIndices, 
  lastSelectedIndex, 
  setLastSelectedIndex,
  dragSrcIndex,
  setDragSrcIndex,
  isOrganizeMode,
  toArrayBuffer
} from './state';

let pdfViewerEl: HTMLElement | null = null;
let thumbContainerEl: HTMLElement | null = null;
let thumbnailObserver: IntersectionObserver | null = null;
let thumbnailGeneration = 0;
let activeThumbnailRenders = 0;
const maxConcurrentThumbnailRenders = 3;
let pendingThumbnailRenders: Array<() => Promise<void>> = [];

function getPDFViewerEl(): HTMLElement {
  if (!pdfViewerEl) pdfViewerEl = document.getElementById('pdf-viewer')!;
  return pdfViewerEl;
}

function getThumbContainerEl(): HTMLElement {
  if (!thumbContainerEl) thumbContainerEl = document.getElementById('thumbnail-container')!;
  return thumbContainerEl;
}

function runThumbnailQueue() {
  while (
    activeThumbnailRenders < maxConcurrentThumbnailRenders &&
    pendingThumbnailRenders.length > 0
  ) {
    const job = pendingThumbnailRenders.shift()!;
    activeThumbnailRenders++;
    job().finally(() => {
      activeThumbnailRenders--;
      runThumbnailQueue();
    });
  }
}

function enqueueThumbnailRender(job: () => Promise<void>) {
  pendingThumbnailRenders.push(job);
  runThumbnailQueue();
}

// Side-bar standard Thumbnails rendering
export async function renderThumbnails(tab: PDFTab) {
  const container = getThumbContainerEl();
  const generation = ++thumbnailGeneration;
  pendingThumbnailRenders = [];
  thumbnailObserver?.disconnect();
  const observer = new IntersectionObserver((entries, observer) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      const box = entry.target.querySelector('.thumbnail-box') as HTMLElement | null;
      const pageItem = tab.pages[Number((entry.target as HTMLElement).dataset.pageIndex)];
      if (!box || !pageItem || pageItem.isBlank) continue;

      const srcTab = tabs.find(t => t.id === pageItem.docId) || tab;
      enqueueThumbnailRender(() => renderThumbnailCanvas(
        srcTab.pdfDoc,
        pageItem.originalPageNum,
        pageItem.rotation,
        box,
        () => generation === thumbnailGeneration && box.isConnected
      ));
    }
  }, {
    root: container.closest('.sidebar-content'),
    rootMargin: '300px 0px'
  });
  thumbnailObserver = observer;
  container.innerHTML = '';

  tab.pages.forEach((pageItem, i) => {
    const pageNum = i + 1;
    const wrapper = document.createElement('div');
    wrapper.className = `thumbnail-wrapper ${pageNum === tab.currentPage ? 'active' : ''}`;
    wrapper.setAttribute('data-page-number', pageNum.toString());
    wrapper.dataset.pageIndex = i.toString();
    wrapper.addEventListener('click', () => {
      const el = document.querySelector(`.page-wrapper[data-page-number="${pageNum}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    });

    const box = document.createElement('div');
    box.className = 'thumbnail-box';
    box.style.width = '120px';
    box.style.height = '160px';

    const label = document.createElement('div');
    label.className = 'thumbnail-label';
    label.innerText = pageNum.toString();

    wrapper.appendChild(box);
    wrapper.appendChild(label);
    container.appendChild(wrapper);

    if (pageItem.isBlank) {
      box.style.backgroundColor = 'white';
      box.style.width = '120px';
      box.style.height = '160px';
      box.innerHTML = '<span style="color:#64748b;font-size:10px;font-weight:bold;display:flex;align-items:center;justify-content:center;height:100%;">BLANK</span>';
    } else {
      box.innerHTML = '<span class="thumbnail-placeholder">Scroll to load</span>';
      observer.observe(wrapper);
    }
  });
}

async function renderThumbnailCanvas(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  pageNum: number,
  rotation: number,
  container: HTMLElement,
  isCurrent: () => boolean
) {
  try {
    if (!isCurrent()) return;
    const page = await pdfDoc.getPage(pageNum);
    if (!isCurrent()) return;
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

    if (!isCurrent()) {
      canvas.width = 0;
      canvas.height = 0;
      return;
    }
    container.innerHTML = '';
    container.appendChild(canvas);
  } catch (e) {
    console.error(`Thumbnail canvas failed at page ${pageNum}:`, e);
  }
}

export function updateActiveThumbnail() {
  const tab = getActiveTab();
  if (!tab) return;

  const container = getThumbContainerEl();
  const thumbs = container.querySelectorAll('.thumbnail-wrapper');
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

// Organize Mode Sorter Page View Layout
export function renderOrganizeGrid() {
  const tab = getActiveTab();
  if (!tab) return;

  const viewer = getPDFViewerEl();
  viewer.innerHTML = '';

  tab.pages.forEach((pageItem, index) => {
    const card = document.createElement('div');
    card.className = `organize-card ${selectedPageIndices.has(index) ? 'selected' : ''}`;
    card.setAttribute('draggable', 'true');
    card.setAttribute('data-seq-index', index.toString());

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

    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.organize-card-actions')) return;
      handleCardSelection(index, e.ctrlKey || e.metaKey, e.shiftKey);
    });

    const body = document.createElement('div');
    body.className = 'organize-card-body';
    body.innerHTML = '<span style="color:var(--text-muted);font-size:11px;">Loading...</span>';

    const label = document.createElement('div');
    label.className = 'organize-card-label';
    
    const srcTab = tabs.find(t => t.id === pageItem.docId) || tab;
    label.innerText = pageItem.isBlank ? 'Blank Page' : srcTab.name;
    label.title = label.innerText;

    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(label);

    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragover', handleDragOver);
    card.addEventListener('dragleave', handleDragLeave);
    card.addEventListener('drop', handleDrop);
    card.addEventListener('dragend', handleDragEnd);

    viewer.appendChild(card);
    renderCardThumbnail(tab, pageItem, body);
  });

  updateOrganizeSelectionUI();
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
export function rotatePageItem(index: number) {
  const tab = getActiveTab();
  if (!tab) return;
  pushHistory(tab);
  tab.pages[index].rotation = (tab.pages[index].rotation + 90) % 360;
  renderOrganizeGrid();
}

export function duplicatePageItem(index: number) {
  const tab = getActiveTab();
  if (!tab) return;
  pushHistory(tab);

  const copy = { ...tab.pages[index] };
  copy.id = `${tab.id}-p${copy.originalPageNum}-${Date.now()}-${Math.random()}`;
  tab.pages.splice(index + 1, 0, copy);
  
  renderOrganizeGrid();
}

export function deletePageItem(index: number) {
  const tab = getActiveTab();
  if (!tab) return;
  pushHistory(tab);
  tab.pages.splice(index, 1);
  renderOrganizeGrid();
}

// Toolbar Sorter Actions
export function insertBlankPage() {
  const tab = getActiveTab();
  if (!tab) return;
  pushHistory(tab);

  tab.pages.push({
    id: `blank-${Date.now()}-${Math.random()}`,
    docId: 'blank',
    originalPageNum: 0,
    rotation: 0,
    isBlank: true
  });

  renderOrganizeGrid();
}

export async function insertOtherPDF() {
  const tab = getActiveTab();
  if (!tab) return;

  try {
    const result = await SelectAndReadPDF();
    if (result && result.data) {
      const arrayBuffer = toArrayBuffer(result.data);
      const otherDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const otherTabId = `other-${Date.now()}-${Math.random()}`;

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
        pages: [],
        undoStack: [],
        redoStack: []
      };
      tabs.push(otherTab);

      pushHistory(tab);
      for (let i = 1; i <= otherDoc.numPages; i++) {
        let width = 612;
        let height = 792;
        try {
          const page = await otherDoc.getPage(i);
          const vp = page.getViewport({ scale: 1.0 });
          width = vp.width;
          height = vp.height;
        } catch (e) {
          console.error('Failed to get inserted page bounds:', e);
        }

        tab.pages.push({
          id: `${otherTabId}-p${i}-${Date.now()}-${Math.random()}`,
          docId: otherTabId,
          path: result.path,
          originalPageNum: i,
          rotation: 0,
          isBlank: false,
          width,
          height
        });
      }

      renderOrganizeGrid();
    }
  } catch (err) {
    alert(`Failed to insert pages: ${err}`);
  }
}

export async function exportPDFDocument() {
  const tab = getActiveTab();
  if (!tab || tab.pages.length === 0) return;

  try {
    const defaultName = tab.name.toLowerCase().endsWith('.pdf') 
      ? tab.name.slice(0, -4) + '_modified.pdf' 
      : tab.name + '_modified.pdf';
      
    const savePath = await SelectSavePath(defaultName);
    if (!savePath) return;

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

// Drag & Drop event bindings
function handleDragStart(e: DragEvent) {
  const target = e.currentTarget as HTMLElement;
  const index = parseInt(target.getAttribute('data-seq-index') || '0');
  setDragSrcIndex(index);
  target.classList.add('dragging');
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
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
  const viewer = getPDFViewerEl();
  viewer.querySelectorAll('.organize-card').forEach(el => el.classList.remove('drag-over'));
}

function handleDrop(e: DragEvent) {
  e.preventDefault();
  const target = e.currentTarget as HTMLElement;
  target.classList.remove('drag-over');

  const destIndex = parseInt(target.getAttribute('data-seq-index') || '0');
  if (dragSrcIndex === null || dragSrcIndex === destIndex) return;

  const tab = getActiveTab();
  if (!tab) return;

  pushHistory(tab);
  const movingItem = tab.pages.splice(dragSrcIndex, 1)[0];
  tab.pages.splice(destIndex, 0, movingItem);

  setDragSrcIndex(null);
  renderOrganizeGrid();
}

// Selection & Batch Action Engine
export function handleCardSelection(index: number, isCtrl: boolean, isShift: boolean) {
  const tab = getActiveTab();
  if (!tab) return;

  if (isShift && lastSelectedIndex !== null) {
    const start = Math.min(lastSelectedIndex, index);
    const end = Math.max(lastSelectedIndex, index);
    if (!isCtrl) {
      selectedPageIndices.clear();
    }
    for (let i = start; i <= end; i++) {
      selectedPageIndices.add(i);
    }
  } else if (isCtrl) {
    if (selectedPageIndices.has(index)) {
      selectedPageIndices.delete(index);
    } else {
      selectedPageIndices.add(index);
      setLastSelectedIndex(index);
    }
  } else {
    selectedPageIndices.clear();
    selectedPageIndices.add(index);
    setLastSelectedIndex(index);
  }

  updateOrganizeSelectionUI();
}

export function updateOrganizeSelectionUI() {
  const viewer = getPDFViewerEl();
  const cards = viewer.querySelectorAll('.organize-card');
  cards.forEach(card => {
    const index = parseInt(card.getAttribute('data-seq-index') || '0');
    if (selectedPageIndices.has(index)) {
      card.classList.add('selected');
    } else {
      card.classList.remove('selected');
    }
  });

  const divider = document.getElementById('org-selection-divider')!;
  const btnRot = document.getElementById('btn-org-rotate-selected')!;
  const btnDup = document.getElementById('btn-org-dup-selected')!;
  const btnExp = document.getElementById('btn-org-export-selected')!;
  const btnDel = document.getElementById('btn-org-del-selected')!;

  if (selectedPageIndices.size > 0) {
    divider.style.display = 'block';
    btnRot.style.display = 'inline-flex';
    btnDup.style.display = 'inline-flex';
    btnExp.style.display = 'inline-flex';
    btnDel.style.display = 'inline-flex';
  } else {
    divider.style.display = 'none';
    btnRot.style.display = 'none';
    btnDup.style.display = 'none';
    btnExp.style.display = 'none';
    btnDel.style.display = 'none';
  }
}

export function rotateSelectedPages() {
  const tab = getActiveTab();
  if (!tab || selectedPageIndices.size === 0) return;
  pushHistory(tab);

  selectedPageIndices.forEach(idx => {
    if (tab.pages[idx]) {
      tab.pages[idx].rotation = (tab.pages[idx].rotation + 90) % 360;
    }
  });

  renderOrganizeGrid();
}

export function duplicateSelectedPages() {
  const tab = getActiveTab();
  if (!tab || selectedPageIndices.size === 0) return;
  pushHistory(tab);

  const newPages: PageItem[] = [];
  for (let i = 0; i < tab.pages.length; i++) {
    newPages.push(tab.pages[i]);
    if (selectedPageIndices.has(i)) {
      const copy = { ...tab.pages[i] };
      copy.id = `${tab.id}-p${copy.originalPageNum}-${Date.now()}-${Math.random()}`;
      newPages.push(copy);
    }
  }
  tab.pages = newPages;
  selectedPageIndices.clear();
  setLastSelectedIndex(null);

  renderOrganizeGrid();
}

export function deleteSelectedPages() {
  const tab = getActiveTab();
  if (!tab || selectedPageIndices.size === 0) return;
  pushHistory(tab);

  tab.pages = tab.pages.filter((_, idx) => !selectedPageIndices.has(idx));
  selectedPageIndices.clear();
  setLastSelectedIndex(null);

  renderOrganizeGrid();
}

// Lasso Marquee Selection logic
let isLassoSelecting = false;
let lassoStartX = 0;
let lassoStartY = 0;
let lassoEl: HTMLElement | null = null;

export function handleLassoMouseDown(e: MouseEvent) {
  if (!isOrganizeMode) return;
  if (e.button !== 0) return;
  const target = e.target as HTMLElement;
  if (target.closest('.organize-card')) return;

  isLassoSelecting = true;
  lassoStartX = e.pageX;
  lassoStartY = e.pageY;

  if (!e.ctrlKey && !e.metaKey) {
    selectedPageIndices.clear();
    updateOrganizeSelectionUI();
  }

  lassoEl = document.createElement('div');
  lassoEl.className = 'lasso-selector';
  document.body.appendChild(lassoEl);

  document.addEventListener('mousemove', handleLassoMouseMove);
  document.addEventListener('mouseup', handleLassoMouseUp);
}

function handleLassoMouseMove(e: MouseEvent) {
  if (!isLassoSelecting || !lassoEl) return;

  const currentX = e.pageX;
  const currentY = e.pageY;

  const left = Math.min(lassoStartX, currentX);
  const top = Math.min(lassoStartY, currentY);
  const width = Math.abs(lassoStartX - currentX);
  const height = Math.abs(lassoStartY - currentY);

  lassoEl.style.left = `${left}px`;
  lassoEl.style.top = `${top}px`;
  lassoEl.style.width = `${width}px`;
  lassoEl.style.height = `${height}px`;

  const viewer = getPDFViewerEl();
  const cards = viewer.querySelectorAll('.organize-card');
  const lassoRect = lassoEl.getBoundingClientRect();

  cards.forEach(card => {
    const idx = parseInt(card.getAttribute('data-seq-index') || '0');
    const cardRect = card.getBoundingClientRect();

    const intersect = !(
      lassoRect.right < cardRect.left ||
      lassoRect.left > cardRect.right ||
      lassoRect.bottom < cardRect.top ||
      lassoRect.top > cardRect.bottom
    );

    if (intersect) {
      selectedPageIndices.add(idx);
    } else if (!e.ctrlKey && !e.metaKey) {
      selectedPageIndices.delete(idx);
    }
  });

  updateOrganizeSelectionUI();
}

function handleLassoMouseUp() {
  if (!isLassoSelecting) return;
  isLassoSelecting = false;
  if (lassoEl) {
    lassoEl.remove();
    lassoEl = null;
  }
  document.removeEventListener('mousemove', handleLassoMouseMove);
  document.removeEventListener('mouseup', handleLassoMouseUp);
}

export async function insertImagesAsPDFPages() {
  const tab = getActiveTab();
  if (!tab) return;

  try {
    const imagePaths = await SelectMultipleImages();
    if (!imagePaths || imagePaths.length === 0) return;

    // Save temporary compiled PDF inside a secure temporary file
    const tempPDFPath = await SaveTempFile('', 'compiled_images.pdf');
    await ImagesToPDF(imagePaths, tempPDFPath);

    // Read the temp PDF to load pages
    const raw = await ReadPDFFile(tempPDFPath);
    const arrayBuffer = toArrayBuffer(raw);
    const imagesDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    
    // Register mock tab to hold the pages
    const imagesTabId = `images-${Date.now()}-${Math.random()}`;
    tabs.push({
      id: imagesTabId,
      name: 'Compiled Images',
      path: tempPDFPath,
      pdfDoc: imagesDoc,
      currentPage: 1,
      zoom: 1.0,
      rotation: 0,
      searchQuery: '',
      searchResults: [],
      currentMatchIndex: -1,
      arrayBuffer,
      pages: [],
      undoStack: [],
      redoStack: []
    });

    pushHistory(tab);

    // Determine insertion index: after the last selected page index or at the end
    let insertIndex = tab.pages.length;
    if (selectedPageIndices.size > 0) {
      insertIndex = Math.max(...selectedPageIndices) + 1;
    }

    for (let i = 1; i <= imagesDoc.numPages; i++) {
      let width = 612;
      let height = 792;
      try {
        const page = await imagesDoc.getPage(i);
        const vp = page.getViewport({ scale: 1.0 });
        width = vp.width;
        height = vp.height;
      } catch (e) {
        console.error('Failed to get compiled page size:', e);
      }

      tab.pages.splice(insertIndex, 0, {
        id: `${imagesTabId}-p${i}-${Date.now()}-${Math.random()}`,
        docId: imagesTabId,
        path: tempPDFPath,
        originalPageNum: i,
        rotation: 0,
        isBlank: false,
        width,
        height
      });
      insertIndex++;
    }

    selectedPageIndices.clear();
    setLastSelectedIndex(null);
    renderOrganizeGrid();
  } catch (err: any) {
    alert(`Failed to insert images: ${err.message || err}`);
  }
}

export async function exportSelectedPagesAsImages() {
  const tab = getActiveTab();
  if (!tab || selectedPageIndices.size === 0) return;

  try {
    const destDir = await SelectDirectory();
    if (!destDir) return;

    const indices = Array.from(selectedPageIndices).sort((a, b) => a - b);
    
    // Disable button temporarily
    const btnExp = document.getElementById('btn-org-export-selected') as HTMLButtonElement;
    const oldText = btnExp.innerText;
    btnExp.disabled = true;
    btnExp.innerText = 'Exporting...';

    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i];
      const pageItem = tab.pages[idx];
      if (!pageItem) continue;

      let canvas = document.createElement('canvas');
      canvas.width = 1200;
      canvas.height = 1600;

      if (pageItem.isBlank) {
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, 1200, 1600);
      } else {
        const srcTab = tabs.find(t => t.id === pageItem.docId) || tab;
        const page = await srcTab.pdfDoc.getPage(pageItem.originalPageNum);
        const finalRotation = (tab.rotation + pageItem.rotation) % 360;
        const viewport = page.getViewport({ scale: 2.0, rotation: finalRotation });

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvas, viewport }).promise;
      }

      const imgBase64 = canvas.toDataURL('image/png').split(',')[1];
      
      canvas.width = 0;
      canvas.height = 0;

      // Save using sequential indices for filenames
      await SaveImagePage(destDir, i, imgBase64);
    }

    btnExp.disabled = false;
    btnExp.innerText = oldText;
    
    alert(`Successfully exported ${indices.length} selected pages as images!`);
  } catch (err: any) {
    alert(`Failed to export pages: ${err.message || err}`);
  }
}
