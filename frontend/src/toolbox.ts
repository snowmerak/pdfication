import * as pdfjsLib from 'pdfjs-dist';
import {
  SelectAndReadPDF,
  SelectSavePath,
  CompressPDF,
  ProtectPDF,
  DecryptPDF,
  AddTextWatermark,
  RemoveAnnotations,
  ListAttachments,
  RemoveAttachments,
  RemoveMetadata,
  ImagesToPDF,
  SelectMultipleImages,
  InitFlattenSession,
  WriteFlattenPage,
  FinalizeFlatten,
  ExportPDF,
  SaveTempFile,
  ReadPDFFile,
  SelectDirectory,
  SaveImagePage
} from '../wailsjs/go/main/App';
import { 
  toArrayBuffer, 
  filepathBase, 
  getActiveTab, 
  tabs,
  PageItem
} from './state';

export let selectedToolPDFPath = '';
export function setSelectedToolPDFPath(val: string) { selectedToolPDFPath = val; }
export let selectedOutputDirPath = '';
export let selectedSavePath = '';

let currentActiveTool = '';
let currentToolTarget = 'local-file';

let toolboxModal!: HTMLElement;
let toolboxModalTitle!: HTMLElement;
let toolboxFormContainer!: HTMLElement;

export function initToolboxDOM() {
  toolboxModal = document.getElementById('toolbox-modal')!;
  toolboxModalTitle = document.getElementById('toolbox-modal-title')!;
  toolboxFormContainer = document.getElementById('toolbox-form-container')!;
}

async function materializeActiveCanvas(): Promise<string> {
  const tab = getActiveTab();
  if (!tab) throw new Error('No active tab');
  
  const sequenceList = tab.pages.map((pageItem: PageItem) => {
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

  const tempPath = await SaveTempFile('', 'canvas_export.pdf');
  await ExportPDF(sequenceList, tempPath);
  return tempPath;
}

function clearAttachmentsList() {
  const group = document.getElementById('attachments-checklist-group');
  const empty = document.getElementById('attachments-empty-msg');
  if (group) group.style.display = 'none';
  if (empty) empty.style.display = 'none';
}

function clearMetadataInfo() {
  const box = document.getElementById('metadata-display-box');
  if (box) box.style.display = 'none';
}

export async function handleToolboxCardClick(tool: string) {
  // Map HTML data-tool values to toolbox-internal identifiers
  if (tool === 'compress') tool = 'compress_pdf';
  else if (tool === 'protect') tool = 'protect_pdf';
  else if (tool === 'decrypt') tool = 'decrypt_pdf';
  else if (tool === 'watermark') tool = 'add_watermark';
  else if (tool === 'number') tool = 'add_page_numbers';
  else if (tool === 'remove-annotations') tool = 'remove_annotations';
  else if (tool === 'attachments') tool = 'manage_attachments';
  else if (tool === 'metadata') tool = 'document_metadata';
  else if (tool === 'flatten') tool = 'flatten_document';
  else if (tool === 'audit') tool = 'structure_audit';
  else if (tool === 'images-to-pdf') tool = 'images_to_pdf';
  else if (tool === 'export-images') tool = 'export_page_images';

  currentActiveTool = tool;
  selectedToolPDFPath = '';
  toolboxFormContainer.innerHTML = '';

  const tab = getActiveTab();

  if (tool === 'images_to_pdf') {
    toolboxModalTitle.innerText = 'Convert Images to PDF';
    toolboxFormContainer.innerHTML = `
      <div class="toolbox-form-group">
        <label>Select Images</label>
        <button class="welcome-btn" id="btn-toolbox-select-images" type="button">Select Images (PNG/JPG)</button>
        <div id="toolbox-selected-images-list" style="margin-top:10px; font-size:12px; color:var(--text-muted); display:flex; flex-direction:column; gap:4px;">
          No images selected
        </div>
      </div>
    `;
    toolboxModal.classList.add('show');

    let selectedImagePaths: string[] = [];
    document.getElementById('btn-toolbox-select-images')!.addEventListener('click', async () => {
      try {
        const paths = await SelectMultipleImages();
        if (paths && paths.length > 0) {
          selectedImagePaths = paths;
          const list = document.getElementById('toolbox-selected-images-list')!;
          list.innerHTML = selectedImagePaths.map(p => `<div>📄 ${filepathBase(p)}</div>`).join('');
          (document.getElementById('toolbox-submit-btn') as HTMLButtonElement).disabled = false;
        }
      } catch (err) {
        alert(err);
      }
    });

    (toolboxModal as any)._selectedImagePaths = () => selectedImagePaths;
    return;
  }

  currentToolTarget = tab ? 'active-tab' : 'local-file';
  selectedToolPDFPath = '';
  selectedOutputDirPath = '';
  selectedSavePath = '';

  // File browser section
  let fileSelectorHTML = '';
  if (tab) {
    fileSelectorHTML = `
      <div class="toolbox-form-group">
        <label>Target Source Document</label>
        <select id="toolbox-target-select" class="form-select">
          <option value="active-tab">Current Canvas: ${tab.name}</option>
          <option value="local-file">Select local PDF file from computer...</option>
        </select>
      </div>
      
      <div class="toolbox-form-group" id="toolbox-file-browser-group" style="display:none;">
        <label>Local PDF File</label>
        <div style="display:flex; gap:8px;">
          <input type="text" id="toolbox-pdf-path" readonly placeholder="No file selected" style="flex:1;">
          <button class="welcome-btn" id="btn-toolbox-browse" type="button">Browse</button>
        </div>
      </div>
    `;
  } else {
    fileSelectorHTML = `
      <div class="toolbox-form-group">
        <label>Target PDF File</label>
        <div style="display:flex; gap:8px;">
          <input type="text" id="toolbox-pdf-path" readonly placeholder="No file selected" style="flex:1;">
          <button class="welcome-btn" id="btn-toolbox-browse" type="button">Browse</button>
        </div>
      </div>
    `;
  }

  // Directory browser for exporting page images
  let outputDirSelectorHTML = `
    <div class="toolbox-form-group">
      <label>Output Folder</label>
      <div style="display:flex; gap:8px;">
        <input type="text" id="toolbox-dir-path" readonly placeholder="No folder selected" style="flex:1;">
        <button class="welcome-btn" id="btn-toolbox-browse-dir" type="button">Select Folder</button>
      </div>
    </div>
  `;

  // File path browser for saving flattened PDF
  let outputFileSelectorHTML = `
    <div class="toolbox-form-group">
      <label>Save Flattened PDF As</label>
      <div style="display:flex; gap:8px;">
        <input type="text" id="toolbox-save-path" readonly placeholder="No destination path selected" style="flex:1;">
        <button class="welcome-btn" id="btn-toolbox-browse-save" type="button">Select Path</button>
      </div>
    </div>
  `;

  if (tool === 'compress_pdf') {
    toolboxModalTitle.innerText = 'Compress PDF';
    toolboxFormContainer.innerHTML = fileSelectorHTML + `
      <p style="font-size:12px; color:var(--text-muted);">Reduces PDF structure size and optimizes resources.</p>
    `;
  } 
  else if (tool === 'protect_pdf') {
    toolboxModalTitle.innerText = 'Protect PDF (Permissions)';
    toolboxFormContainer.innerHTML = fileSelectorHTML + `
      <div class="toolbox-form-group">
        <label>User Password (Open Document)</label>
        <input type="password" id="protect-user-pw" placeholder="Optional">
      </div>
      <div class="toolbox-form-group">
        <label>Owner Password (Control Permissions)</label>
        <input type="password" id="protect-owner-pw" placeholder="Optional">
      </div>
      <div class="toolbox-form-group">
        <label style="display:flex; align-items:center; gap:8px; font-weight:normal; cursor:pointer;">
          <input type="checkbox" id="protect-allow-print" checked>
          Allow Printing
        </label>
      </div>
      <div class="toolbox-form-group">
        <label style="display:flex; align-items:center; gap:8px; font-weight:normal; cursor:pointer;">
          <input type="checkbox" id="protect-allow-copy" checked>
          Allow Copying & Text Extraction
        </label>
      </div>
    `;
  }
  else if (tool === 'decrypt_pdf') {
    toolboxModalTitle.innerText = 'Decrypt PDF';
    toolboxFormContainer.innerHTML = fileSelectorHTML + `
      <div class="toolbox-form-group">
        <label>Password</label>
        <input type="password" id="decrypt-password" placeholder="Required if locked">
      </div>
    `;
  }
  else if (tool === 'add_watermark') {
    toolboxModalTitle.innerText = 'Add Text Watermark';
    toolboxFormContainer.innerHTML = fileSelectorHTML + `
      <div class="toolbox-form-group">
        <label>Watermark Text</label>
        <input type="text" id="watermark-text" placeholder="Confidential, Draft, etc.">
      </div>
      <div class="toolbox-form-group">
        <label>Configuration Properties (pdfcpu syntax)</label>
        <input type="text" id="watermark-desc" value="scale:0.5 abs, rot:45, opac:0.3, color:0.7 0.7 0.7" placeholder="e.g. scale:0.5, rot:45, opac:0.3">
      </div>
      <div class="toolbox-form-group">
        <label style="display:flex; align-items:center; gap:8px; font-weight:normal; cursor:pointer;">
          <input type="checkbox" id="watermark-on-top" checked>
          Stamp on top of page content (instead of background)
        </label>
      </div>
    `;
  }
  else if (tool === 'add_page_numbers') {
    toolboxModalTitle.innerText = 'Add Page Numbers';
    toolboxFormContainer.innerHTML = fileSelectorHTML + `
      <div class="toolbox-form-group">
        <label>Page Number Format</label>
        <input type="text" id="num-format" value="Page %p of %P" placeholder="e.g. Page %p or %p">
      </div>
      <div class="toolbox-form-group">
        <label>Location & Style Parameters (pdfcpu syntax)</label>
        <input type="text" id="num-desc" value="pos:br, scale:10.0, color:0 0 0" placeholder="e.g. pos:br, scale:10.0">
      </div>
    `;
  }
  else if (tool === 'remove_annotations') {
    toolboxModalTitle.innerText = 'Remove Annotations';
    toolboxFormContainer.innerHTML = fileSelectorHTML + `
      <p style="font-size:12px; color:var(--text-muted);">Deletes text markups, comments, stamps, and hyper-references.</p>
    `;
  }
  else if (tool === 'manage_attachments') {
    toolboxModalTitle.innerText = 'Manage Attachments';
    toolboxFormContainer.innerHTML = fileSelectorHTML + `
      <div id="attachments-loading-state" style="display:none; font-size:12px; color:var(--text-muted); margin-bottom:10px;">
        Loading attachments list...
      </div>
      <div class="toolbox-form-group" id="attachments-checklist-group" style="display:none;">
        <label>Select Attachments to Delete</label>
        <div id="attachments-checklist" class="attachments-checklist">
          <!-- Populated dynamically -->
        </div>
      </div>
      <p id="attachments-empty-msg" style="display:none; font-size:12px; color:var(--text-muted);">No attachments found in this document.</p>
    `;

    if (currentToolTarget === 'active-tab') {
      const loadingEl = document.getElementById('attachments-loading-state')!;
      loadingEl.style.display = 'block';
      (async () => {
        try {
          const tempPath = await materializeActiveCanvas();
          await loadAttachmentsList(tempPath);
        } catch(e) { console.error(e); }
      })();
    }
  }
  else if (tool === 'document_metadata') {
    toolboxModalTitle.innerText = 'Clear Document Metadata';
    toolboxFormContainer.innerHTML = fileSelectorHTML + `
      <div id="metadata-loading-state" style="display:none; font-size:12px; color:var(--text-muted); margin-bottom:10px;">
        Loading file metadata...
      </div>
      <div id="metadata-display-box" class="metadata-display-box" style="display:none;">
        <!-- Populated dynamically -->
      </div>
      <p style="margin-top:12px; font-size:12px; color:var(--text-muted);">Clears general document dictionary keys (Title, Author, Dates).</p>
    `;

    if (currentToolTarget === 'active-tab') {
      const loadingEl = document.getElementById('metadata-loading-state')!;
      loadingEl.style.display = 'block';
      (async () => {
        try {
          const tempPath = await materializeActiveCanvas();
          await loadMetadataInfo(tempPath);
        } catch(e) { console.error(e); }
      })();
    }
  }
  else if (tool === 'structure_audit') {
    toolboxModalTitle.innerText = 'Structure Security Audit Scan';
    toolboxFormContainer.innerHTML = fileSelectorHTML + `
      <div class="toolbox-form-group">
        <button class="welcome-btn" id="btn-toolbox-run-audit" type="button" style="width:100%;">Run Vulnerability Scan</button>
      </div>
      <div id="audit-log-output" class="audit-log-output" style="display:none;">
        <!-- Populated dynamically -->
      </div>
    `;

    document.getElementById('btn-toolbox-run-audit')!.addEventListener('click', runStructureAudit);
  }
  else if (tool === 'flatten_document') {
    toolboxModalTitle.innerText = 'Flatten Document (Canvas/PDF)';
    toolboxFormContainer.innerHTML = fileSelectorHTML + outputFileSelectorHTML + `
      <p style="font-size:12px; color:var(--text-muted); margin-top:8px;">
        Rasterizes all pages of the document into a flat, image-only PDF.
      </p>
      <div id="flatten-progress-bar" style="display:none; margin-top:10px;">
        <div style="font-size:12px; color:var(--text-muted); margin-bottom:6px;" id="flatten-progress-text">Rasterizing page 0/0...</div>
        <div style="width:100%; height:8px; background-color:#334155; border-radius:4px; overflow:hidden;">
          <div id="flatten-progress-fill" style="width:0%; height:100%; background-color:var(--accent-color); transition:width 0.1s;"></div>
        </div>
      </div>
    `;
  }
  else if (tool === 'export_page_images') {
    toolboxModalTitle.innerText = 'Export Pages as PNG Images';
    toolboxFormContainer.innerHTML = fileSelectorHTML + outputDirSelectorHTML + `
      <p style="font-size:12px; color:var(--text-muted); margin-top:8px;">
        Converts all pages of the document to high-resolution PNG files and exports them to a selected folder.
      </p>
      <div id="export-progress-bar" style="display:none; margin-top:10px;">
        <div style="font-size:12px; color:var(--text-muted); margin-bottom:6px;" id="export-progress-text">Exporting page 0/0...</div>
        <div style="width:100%; height:8px; background-color:#334155; border-radius:4px; overflow:hidden;">
          <div id="export-progress-fill" style="width:0%; height:100%; background-color:var(--accent-color); transition:width 0.1s;"></div>
        </div>
      </div>
    `;
  }

  toolboxModal.classList.add('show');
  toggleSubmitButtonState();

  const targetSelect = document.getElementById('toolbox-target-select') as HTMLSelectElement | null;
  const browserGroup = document.getElementById('toolbox-file-browser-group');
  
  if (targetSelect && browserGroup) {
    targetSelect.addEventListener('change', async () => {
      currentToolTarget = targetSelect.value;
      if (currentToolTarget === 'active-tab') {
        browserGroup.style.display = 'none';
        selectedToolPDFPath = '';
        toggleSubmitButtonState();
        
        if (tool === 'manage_attachments') {
          const loadingEl = document.getElementById('attachments-loading-state')!;
          loadingEl.style.display = 'block';
          document.getElementById('attachments-checklist-group')!.style.display = 'none';
          document.getElementById('attachments-empty-msg')!.style.display = 'none';
          try {
            const tempPath = await materializeActiveCanvas();
            await loadAttachmentsList(tempPath);
          } catch(e) { console.error(e); }
        } else if (tool === 'document_metadata') {
          const loadingEl = document.getElementById('metadata-loading-state')!;
          loadingEl.style.display = 'block';
          document.getElementById('metadata-display-box')!.style.display = 'none';
          try {
            const tempPath = await materializeActiveCanvas();
            await loadMetadataInfo(tempPath);
          } catch(e) { console.error(e); }
        }
      } else {
        browserGroup.style.display = 'block';
        toggleSubmitButtonState();
        
        if (tool === 'manage_attachments') {
          clearAttachmentsList();
        } else if (tool === 'document_metadata') {
          clearMetadataInfo();
        }
      }
    });
  }

  const browseBtn = document.getElementById('btn-toolbox-browse');
  if (browseBtn) {
    browseBtn.addEventListener('click', async () => {
      try {
        const result = await SelectAndReadPDF();
        if (result && result.path) {
          selectedToolPDFPath = result.path;
          (document.getElementById('toolbox-pdf-path') as HTMLInputElement).value = selectedToolPDFPath;
          toggleSubmitButtonState();

          if (tool === 'manage_attachments') {
            loadAttachmentsList(selectedToolPDFPath);
          } else if (tool === 'document_metadata') {
            loadMetadataInfo(selectedToolPDFPath);
          }
        }
      } catch (err) {
        alert(err);
      }
    });
  }

  const browseDirBtn = document.getElementById('btn-toolbox-browse-dir');
  if (browseDirBtn) {
    browseDirBtn.addEventListener('click', async () => {
      try {
        const path = await SelectDirectory();
        if (path) {
          selectedOutputDirPath = path;
          (document.getElementById('toolbox-dir-path') as HTMLInputElement).value = selectedOutputDirPath;
          toggleSubmitButtonState();
        }
      } catch (err) {
        alert(err);
      }
    });
  }

  const browseSaveBtn = document.getElementById('btn-toolbox-browse-save');
  if (browseSaveBtn) {
    browseSaveBtn.addEventListener('click', async () => {
      try {
        const defaultName = tab ? tab.name.replace(/\.pdf$/i, '_flat.pdf') : 'document_flat.pdf';
        const path = await SelectSavePath(defaultName);
        if (path) {
          selectedSavePath = path;
          (document.getElementById('toolbox-save-path') as HTMLInputElement).value = selectedSavePath;
          toggleSubmitButtonState();
        }
      } catch (err) {
        alert(err);
      }
    });
  }
}

function toggleSubmitButtonState() {
  const submitBtn = document.getElementById('toolbox-submit-btn') as HTMLButtonElement;
  
  if (currentActiveTool === 'images_to_pdf') {
    const list = (toolboxModal as any)._selectedImagePaths;
    submitBtn.disabled = !(list && list().length > 0);
    return;
  }

  // Check target PDF source selection validity
  let targetValid = false;
  if (currentToolTarget === 'active-tab') {
    targetValid = !!getActiveTab();
  } else {
    targetValid = !!selectedToolPDFPath;
  }
  
  if (!targetValid) {
    submitBtn.disabled = true;
    return;
  }
  
  // Check output destination validity
  if (currentActiveTool === 'export_page_images') {
    submitBtn.disabled = !selectedOutputDirPath;
  } else if (currentActiveTool === 'flatten_document') {
    submitBtn.disabled = !selectedSavePath;
  } else {
    submitBtn.disabled = false;
  }
}

async function loadAttachmentsList(path: string) {
  const loading = document.getElementById('attachments-loading-state')!;
  const group = document.getElementById('attachments-checklist-group')!;
  const container = document.getElementById('attachments-checklist')!;
  const empty = document.getElementById('attachments-empty-msg')!;

  loading.style.display = 'block';
  group.style.display = 'none';
  empty.style.display = 'none';
  container.innerHTML = '';

  try {
    const attachments = await ListAttachments(path);
    loading.style.display = 'none';

    if (attachments && attachments.length > 0) {
      group.style.display = 'block';
      attachments.forEach(name => {
        const item = document.createElement('label');
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.gap = '8px';
        item.style.cursor = 'pointer';
        item.innerHTML = `
          <input type="checkbox" name="toolbox-attachment-item" value="${name}">
          <span>${name}</span>
        `;
        container.appendChild(item);
      });
    } else {
      empty.style.display = 'block';
    }
  } catch (err) {
    loading.style.display = 'none';
    alert(`Could not read attachments: ${err}`);
  }
}

async function loadMetadataInfo(path: string) {
  const loading = document.getElementById('metadata-loading-state')!;
  const box = document.getElementById('metadata-display-box')!;

  loading.style.display = 'block';
  box.style.display = 'none';
  box.innerHTML = '';

  try {
    const response = await SelectAndReadPDF(); // dummy trigger to read bytes or we can just fetch via path
    let dataBytes: Uint8Array;
    if (response && response.path === path && response.data) {
      dataBytes = new Uint8Array(toArrayBuffer(response.data));
    } else {
      const raw = await (window as any).go.main.App.ReadPDFFile(path);
      dataBytes = new Uint8Array(toArrayBuffer(raw));
    }

    const pdfDoc = await pdfjsLib.getDocument({ data: dataBytes }).promise;
    const meta = await pdfDoc.getMetadata();
    loading.style.display = 'none';
    box.style.display = 'block';

    const info: any = meta.info || {};
    const metaLines = [
      `Title: ${info.Title || 'None'}`,
      `Author: ${info.Author || 'None'}`,
      `Subject: ${info.Subject || 'None'}`,
      `Keywords: ${info.Keywords || 'None'}`,
      `Creator: ${info.Creator || 'None'}`,
      `Producer: ${info.Producer || 'None'}`,
      `Creation Date: ${info.CreationDate || 'None'}`,
      `Mod Date: ${info.ModDate || 'None'}`
    ];
    box.innerHTML = metaLines.map(line => `<div>${line}</div>`).join('');
  } catch (err) {
    loading.style.display = 'none';
    box.style.display = 'block';
    box.innerHTML = `<div style="color:#ef4444;">Error reading metadata: ${err}</div>`;
  }
}

async function runStructureAudit() {
  const logBox = document.getElementById('audit-log-output')!;
  logBox.style.display = 'block';
  logBox.innerHTML = '<div>Scanning catalog structure elements...</div>';

  try {
    let sourcePath = selectedToolPDFPath;
    const tab = getActiveTab();
    if (currentToolTarget === 'active-tab' && tab) {
      sourcePath = await materializeActiveCanvas();
    }

    if (!sourcePath) {
      logBox.innerHTML = '<div style="color:#ef4444;">Please select a PDF file first.</div>';
      return;
    }

    const raw = await ReadPDFFile(sourcePath);
    const dataBytes = new Uint8Array(toArrayBuffer(raw));

    const pdfDoc = await pdfjsLib.getDocument({ data: dataBytes }).promise;
    logBox.innerHTML += `<div>Pages count: ${pdfDoc.numPages}</div>`;

    const jsActions = await pdfDoc.getJSActions();
    const hasJS = jsActions && Object.keys(jsActions).length > 0;
    
    logBox.innerHTML += `<div style="color:${hasJS ? '#ef4444; font-weight:bold;' : '#22c55e;'}">
      Embedded JavaScript OpenActions: ${hasJS ? 'Found! (' + Object.keys(jsActions).join(', ') + ')' : 'Clean (None)'}
    </div>`;

    let totalLinks = 0;
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const annotations = await page.getAnnotations();
      const links = annotations.filter((ann: any) => ann.subtype === 'Link');
      totalLinks += links.length;
    }
    
    logBox.innerHTML += `<div>External Hyperlinks annotations: ${totalLinks}</div>`;
    logBox.innerHTML += `<div style="color:#22c55e; margin-top:8px; font-weight:bold;">Scan Complete.</div>`;
  } catch (err) {
    logBox.innerHTML += `<div style="color:#ef4444;">Scan failed: ${err}</div>`;
  }
}

export async function runToolboxAction() {
  const tab = getActiveTab();
  const submitBtn = document.getElementById('toolbox-submit-btn') as HTMLButtonElement;
  submitBtn.disabled = true;

  try {
    if (currentActiveTool === 'flatten_document') {
      await runClientFlattenDocument();
      return;
    }
    if (currentActiveTool === 'export_page_images') {
      await runClientExportPageImages();
      return;
    }

    let defaultSaveName = 'document.pdf';
    if (selectedToolPDFPath) {
      defaultSaveName = filepathBase(selectedToolPDFPath);
    } else if (tab) {
      defaultSaveName = tab.name;
    }

    let outSaveName = defaultSaveName;
    if (currentActiveTool === 'compress_pdf') outSaveName = outSaveName.replace(/\.pdf$/i, '_compressed.pdf');
    else if (currentActiveTool === 'protect_pdf') outSaveName = outSaveName.replace(/\.pdf$/i, '_protected.pdf');
    else if (currentActiveTool === 'decrypt_pdf') outSaveName = outSaveName.replace(/\.pdf$/i, '_decrypted.pdf');
    else if (currentActiveTool === 'add_watermark') outSaveName = outSaveName.replace(/\.pdf$/i, '_watermarked.pdf');
    else if (currentActiveTool === 'add_page_numbers') outSaveName = outSaveName.replace(/\.pdf$/i, '_numbered.pdf');
    else if (currentActiveTool === 'remove_annotations') outSaveName = outSaveName.replace(/\.pdf$/i, '_clean.pdf');
    else if (currentActiveTool === 'manage_attachments') outSaveName = outSaveName.replace(/\.pdf$/i, '_attachments.pdf');
    else if (currentActiveTool === 'document_metadata') outSaveName = outSaveName.replace(/\.pdf$/i, '_clean_metadata.pdf');
    else if (currentActiveTool === 'images_to_pdf') outSaveName = 'images_compiled.pdf';

    const savePath = await SelectSavePath(outSaveName);
    if (!savePath) {
      submitBtn.disabled = false;
      return;
    }

    let sourcePath = selectedToolPDFPath;
    const isPDFTargetTool = [
      'compress_pdf',
      'protect_pdf',
      'decrypt_pdf',
      'add_watermark',
      'add_page_numbers',
      'remove_annotations',
      'manage_attachments',
      'document_metadata'
    ].includes(currentActiveTool);

    if (isPDFTargetTool && tab && (sourcePath === tab.path || !sourcePath)) {
      // Compile the active tab's current pages array into a temp PDF
      const sequenceList = tab.pages.map((pageItem: PageItem) => {
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

      const tempPath = await SaveTempFile('', 'canvas_export.pdf');
      await ExportPDF(sequenceList, tempPath);
      sourcePath = tempPath;
    }

    if (currentActiveTool === 'compress_pdf') {
      await CompressPDF(sourcePath, savePath);
    } 
    else if (currentActiveTool === 'protect_pdf') {
      const user = (document.getElementById('protect-user-pw') as HTMLInputElement).value;
      const owner = (document.getElementById('protect-owner-pw') as HTMLInputElement).value;
      const print = (document.getElementById('protect-allow-print') as HTMLInputElement).checked;
      const copy = (document.getElementById('protect-allow-copy') as HTMLInputElement).checked;
      await ProtectPDF(sourcePath, savePath, user, owner, print, copy);
    }
    else if (currentActiveTool === 'decrypt_pdf') {
      const password = (document.getElementById('decrypt-password') as HTMLInputElement).value;
      await DecryptPDF(sourcePath, savePath, password);
    }
    else if (currentActiveTool === 'add_watermark') {
      const text = (document.getElementById('watermark-text') as HTMLInputElement).value;
      const desc = (document.getElementById('watermark-desc') as HTMLInputElement).value;
      const onTop = (document.getElementById('watermark-on-top') as HTMLInputElement).checked;
      await AddTextWatermark(sourcePath, savePath, text, desc, onTop);
    }
    else if (currentActiveTool === 'add_page_numbers') {
      const format = (document.getElementById('num-format') as HTMLInputElement).value;
      const desc = (document.getElementById('num-desc') as HTMLInputElement).value;
      await AddTextWatermark(sourcePath, savePath, format, desc, true);
    }
    else if (currentActiveTool === 'remove_annotations') {
      await RemoveAnnotations(sourcePath, savePath);
    }
    else if (currentActiveTool === 'manage_attachments') {
      const checkedBoxes = document.querySelectorAll('input[name="toolbox-attachment-item"]:checked');
      const filesToRemove = Array.from(checkedBoxes).map(el => (el as HTMLInputElement).value);
      if (filesToRemove.length === 0) {
        alert('Please check at least one attachment to delete.');
        submitBtn.disabled = false;
        return;
      }
      await RemoveAttachments(sourcePath, savePath, filesToRemove);
    }
    else if (currentActiveTool === 'document_metadata') {
      await RemoveMetadata(sourcePath, savePath);
    }
    else if (currentActiveTool === 'images_to_pdf') {
      const paths = (toolboxModal as any)._selectedImagePaths();
      await ImagesToPDF(paths, savePath);
    }

    alert('Tool executed successfully!');
    toolboxModal.classList.remove('show');
  } catch (err: any) {
    alert(`Tool execution failed: ${err.message || err}`);
  } finally {
    submitBtn.disabled = false;
  }
}

// Client-side Page Canvas Rasterizer and Exporter (Atomic implementation)
async function runClientFlattenDocument() {
  const tab = getActiveTab();
  if (!tab) return;

  const progressContainer = document.getElementById('flatten-progress-bar')!;
  const progressText = document.getElementById('flatten-progress-text')!;
  const progressFill = document.getElementById('flatten-progress-fill')!;
  
  progressContainer.style.display = 'block';

  try {
    const defaultName = tab.name.replace(/\.pdf$/i, '_flat.pdf');
    const savePath = await SelectSavePath(defaultName);
    if (!savePath) return;

    // Start secure session on backend
    const sessionDir = await InitFlattenSession();
    const totalPages = tab.pages.length;

    for (let i = 0; i < totalPages; i++) {
      progressText.innerText = `Rasterizing page ${i + 1}/${totalPages}...`;
      progressFill.style.width = `${((i + 1) / totalPages) * 100}%`;

      const pageItem = tab.pages[i];
      let base64 = '';
      
      if (pageItem.isBlank) {
        const blankCanvas = document.createElement('canvas');
        blankCanvas.width = 1200;
        blankCanvas.height = 1600;
        const ctx = blankCanvas.getContext('2d')!;
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, 1200, 1600);
        base64 = blankCanvas.toDataURL('image/png').split(',')[1];
      } else {
        const srcTab = tabs.find(t => t.id === pageItem.docId) || tab;
        const page = await srcTab.pdfDoc.getPage(pageItem.originalPageNum);
        const finalRotation = (tab.rotation + pageItem.rotation) % 360;
        const viewport = page.getViewport({ scale: 2.0, rotation: finalRotation });

        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvas, viewport }).promise;
        base64 = canvas.toDataURL('image/png').split(',')[1];
        
        // Clean canvas size to release context memory
        canvas.width = 0;
        canvas.height = 0;
      }

      // Write page incrementally to disk
      await WriteFlattenPage(sessionDir, i, base64);
    }

    progressText.innerText = 'Compiling image pages to PDF...';
    await FinalizeFlatten(sessionDir, savePath);

    alert('Document flattened successfully!');
    toolboxModal.classList.remove('show');
  } catch (err: any) {
    alert(`Flattening failed: ${err.message || err}`);
  } finally {
    progressContainer.style.display = 'none';
    (document.getElementById('toolbox-submit-btn') as HTMLButtonElement).disabled = false;
  }
}

async function runClientExportPageImages() {
  const tab = getActiveTab();
  if (!tab) return;

  const progressContainer = document.getElementById('export-progress-bar')!;
  const progressText = document.getElementById('export-progress-text')!;
  const progressFill = document.getElementById('export-progress-fill')!;
  
  progressContainer.style.display = 'block';

  try {
    // Open native folder selection picker
    const destDir = await SelectDirectory();
    if (!destDir) return;

    const totalPages = tab.pages.length;

    for (let i = 0; i < totalPages; i++) {
      progressText.innerText = `Exporting page ${i + 1}/${totalPages}...`;
      progressFill.style.width = `${((i + 1) / totalPages) * 100}%`;

      const pageItem = tab.pages[i];
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
      
      // Clean canvas context memory
      canvas.width = 0;
      canvas.height = 0;

      // Secure save image page directly to selected folder
      await SaveImagePage(destDir, i, imgBase64);
    }

    alert('All page images exported successfully!');
    toolboxModal.classList.remove('show');
  } catch (err: any) {
    alert(`Export failed: ${err.message || err}`);
  } finally {
    progressContainer.style.display = 'none';
    (document.getElementById('toolbox-submit-btn') as HTMLButtonElement).disabled = false;
  }
}


