package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/snowmerak/pdfication/internal/pdfservice"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	ctx context.Context
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	// Clean and recreate a local temp folder in the workspace
	_ = os.RemoveAll("temp")
	_ = os.MkdirAll("temp", 0755)
}

// shutdown is called when the app shuts down
func (a *App) shutdown(ctx context.Context) {
	// Clean up local temp folder on exit
	_ = os.RemoveAll("temp")
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

// SaveTempFile saves base64 bytes (from frontend drag-and-drop) inside local temp/ and returns its absolute path
func (a *App) SaveTempFile(base64Data, filename string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return "", fmt.Errorf("failed to decode temp file: %w", err)
	}

	tempPath := filepath.Join("temp", fmt.Sprintf("dropped_%d_%s", time.Now().UnixNano(), filename))
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
