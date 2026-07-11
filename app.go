package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/snowmerak/pdfication/internal/pdfservice"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct manages application-level lifecycle and delegates actions
type App struct {
	ctx     context.Context
	tempDir string
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. It initializes a secure OS temp folder
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	tempDir, err := os.MkdirTemp("", "pdfication-session-*")
	if err == nil {
		a.tempDir = tempDir
	}
}

// shutdown is called when the app shuts down and cleans up temp sessions
func (a *App) shutdown(ctx context.Context) {
	if a.tempDir != "" {
		_ = os.RemoveAll(a.tempDir)
	}
}

// SelectAndReadPDF opens a file dialog to choose a PDF and returns its name, path, and contents
func (a *App) SelectAndReadPDF() (map[string]interface{}, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select PDF File",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "PDF Files (*.pdf)",
				Pattern:     "*.pdf",
			},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("file dialog error: %w", err)
	}
	if path == "" {
		return nil, nil
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	return map[string]interface{}{
		"name": filepath.Base(path),
		"path": path,
		"data": data,
	}, nil
}

// ReadPDFFile reads the contents of a PDF file by its absolute path
func (a *App) ReadPDFFile(path string) ([]byte, error) {
	return os.ReadFile(path)
}

// SaveTempFile saves base64 bytes inside the secure OS tempDir and returns its absolute path
func (a *App) SaveTempFile(base64Data, filename string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return "", fmt.Errorf("failed to decode temp file: %w", err)
	}

	// Sanitize filename to prevent path traversal
	filename = filepath.Base(filename)
	
	tempPath := filepath.Join(a.tempDir, fmt.Sprintf("dropped_%d_%s", time.Now().UnixNano(), filename))
	err = os.WriteFile(tempPath, data, 0644)
	if err != nil {
		return "", fmt.Errorf("failed to write temp file: %w", err)
	}

	absPath, err := filepath.Abs(tempPath)
	if err != nil {
		return tempPath, nil
	}
	return absPath, nil
}

// SelectDirectory opens a native directory selection dialog
func (a *App) SelectDirectory() (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Export Folder",
	})
}

// SaveImagePage securely writes base64 image data to a validated destination directory
func (a *App) SaveImagePage(destDir string, pageIndex int, base64Data string) error {
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return fmt.Errorf("failed to decode page image: %w", err)
	}

	info, err := os.Stat(destDir)
	if err != nil || !info.IsDir() {
		return fmt.Errorf("invalid output destination directory")
	}

	destPath := filepath.Join(destDir, fmt.Sprintf("page_%d.png", pageIndex + 1))
	return os.WriteFile(destPath, data, 0644)
}

// InitFlattenSession creates a temporary subdirectory for incremental page flattening
func (a *App) InitFlattenSession() (string, error) {
	if a.tempDir == "" {
		return "", fmt.Errorf("secure temp directory not initialized")
	}
	sessionDir, err := os.MkdirTemp(a.tempDir, "flatten-*")
	if err != nil {
		return "", fmt.Errorf("failed to create flatten session: %w", err)
	}
	return sessionDir, nil
}

// WriteFlattenPage writes a single flattened page canvas base64 to disk, keeping memory low
func (a *App) WriteFlattenPage(sessionDir string, pageIndex int, base64Data string) error {
	// Security boundary verification: ensure sessionDir resides under app tempDir
	if a.tempDir == "" || !strings.HasPrefix(sessionDir, a.tempDir) {
		return fmt.Errorf("unauthorized directory path")
	}

	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return fmt.Errorf("failed to decode base64 page %d: %w", pageIndex, err)
	}

	tempPath := filepath.Join(sessionDir, fmt.Sprintf("page_%d.png", pageIndex))
	return os.WriteFile(tempPath, data, 0644)
}

// FinalizeFlatten merges all page images into a flat PDF and deletes the session directory
func (a *App) FinalizeFlatten(sessionDir string, destPath string) error {
	if a.tempDir == "" || !strings.HasPrefix(sessionDir, a.tempDir) {
		return fmt.Errorf("unauthorized directory path")
	}
	defer os.RemoveAll(sessionDir)

	entries, err := os.ReadDir(sessionDir)
	if err != nil {
		return fmt.Errorf("failed to read session pages: %w", err)
	}

	var imagePaths []string
	// Retrieve files ordered by sequential page index
	for i := 0; i < len(entries); i++ {
		path := filepath.Join(sessionDir, fmt.Sprintf("page_%d.png", i))
		if _, err := os.Stat(path); err == nil {
			imagePaths = append(imagePaths, path)
		}
	}

	if len(imagePaths) == 0 {
		return fmt.Errorf("no flattened pages found in session")
	}

	return pdfservice.ImagesToPDF(imagePaths, destPath)
}

// SelectSavePath opens a save file dialog and returns the chosen save path
func (a *App) SelectSavePath(filename string) (string, error) {
	return runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Save PDF As",
		DefaultFilename: filename,
		Filters: []runtime.FileFilter{
			{
				DisplayName: "PDF Files (*.pdf)",
				Pattern:     "*.pdf",
			},
		},
	})
}

// ExportPDF compiles the final PDF document from the layout specs list
func (a *App) ExportPDF(sequence []pdfservice.PageSpec, destPath string) error {
	return pdfservice.ExportPDF(sequence, destPath)
}

// CompressPDF optimizes PDF resources and shrinks structure size
func (a *App) CompressPDF(srcPath, destPath string) error {
	return pdfservice.Compress(srcPath, destPath)
}

// ProtectPDF encrypts document with user/owner passwords and copy/print restrictions
func (a *App) ProtectPDF(srcPath, destPath, userPW, ownerPW string, allowPrint, allowCopy bool) error {
	return pdfservice.Protect(srcPath, destPath, userPW, ownerPW, allowPrint, allowCopy)
}

// DecryptPDF removes password security restrictions from PDF
func (a *App) DecryptPDF(srcPath, destPath, password string) error {
	return pdfservice.Decrypt(srcPath, destPath, password)
}

// AddTextWatermark stamps a custom text overlay on document pages
func (a *App) AddTextWatermark(srcPath, destPath, text, desc string, onTop bool) error {
	return pdfservice.Watermark(srcPath, destPath, text, desc, onTop)
}

// RemoveAnnotations removes annotations (links, text highlights, comments) from PDF
func (a *App) RemoveAnnotations(srcPath, destPath string) error {
	return pdfservice.RemoveAnnotations(srcPath, destPath)
}

// ListAttachments returns a slice of file attachment names present in the PDF
func (a *App) ListAttachments(srcPath string) ([]string, error) {
	return pdfservice.ListAttachments(srcPath)
}

// RemoveAttachments deletes specified file attachments from the PDF
func (a *App) RemoveAttachments(srcPath, destPath string, files []string) error {
	return pdfservice.RemoveAttachments(srcPath, destPath, files)
}

// RemoveMetadata clears typical document info metadata properties from the PDF
func (a *App) RemoveMetadata(srcPath, destPath string) error {
	return pdfservice.RemoveMetadata(srcPath, destPath)
}

// ImagesToPDF compiles images into a single PDF document
func (a *App) ImagesToPDF(imagePaths []string, destPath string) error {
	return pdfservice.ImagesToPDF(imagePaths, destPath)
}

// FlattenDocument compiles page base64 images into a flat image-only PDF
func (a *App) FlattenDocument(pageBase64s []string, destPath string) error {
	return pdfservice.FlattenDocument(pageBase64s, destPath)
}

// SelectMultipleImages opens a file dialog to choose multiple image files
func (a *App) SelectMultipleImages() ([]string, error) {
	return runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Image Files",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "Image Files (*.png; *.jpg; *.jpeg)",
				Pattern:     "*.png;*.jpg;*.jpeg",
			},
		},
	})
}
