package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strconv"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/types"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// PageSpec defines the parameters for a single page in the export sequence
type PageSpec struct {
	Path       string `json:"path"`
	PageNumber int    `json:"pageNumber"`
	Rotation   int    `json:"rotation"`
	IsBlank    bool   `json:"isBlank"`
}

// App struct
type App struct {
	ctx         context.Context
	openedFiles map[string][]byte
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		openedFiles: make(map[string][]byte),
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// Greet returns a greeting for the given name
func (a *App) Greet(name string) string {
	return fmt.Sprintf("Hello %s, It's show time!", name)
}

// SelectAndReadPDF opens a file dialog and returns selected file's name, path and bytes
func (a *App) SelectAndReadPDF() (map[string]interface{}, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Open PDF File",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "PDF Files (*.pdf)",
				Pattern:     "*.pdf",
			},
		},
	})
	if err != nil {
		return nil, err
	}
	if path == "" {
		return nil, nil
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	a.openedFiles[path] = data

	return map[string]interface{}{
		"name": filepath.Base(path),
		"path": path,
		"data": data,
	}, nil
}

// ReadPDFFile reads the contents of the given file path
func (a *App) ReadPDFFile(path string) ([]byte, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	a.openedFiles[path] = data
	return data, nil
}

// SelectSavePath opens a save dialog and returns the target path to export the PDF
func (a *App) SelectSavePath(filename string) (string, error) {
	return runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Export PDF File",
		DefaultFilename: filename,
		Filters: []runtime.FileFilter{
			{
				DisplayName: "PDF Files (*.pdf)",
				Pattern:     "*.pdf",
			},
		},
	})
}

// ExportPDF compiles the page sequence into the final PDF path using pdfcpu APIs
func (a *App) ExportPDF(sequence []PageSpec, destPath string) error {
	tempDir, err := os.MkdirTemp("", "pdfication-*")
	if err != nil {
		return fmt.Errorf("failed to create temp dir: %w", err)
	}
	defer os.RemoveAll(tempDir)

	var tempFiles []string
	for i, spec := range sequence {
		tempPagePath := filepath.Join(tempDir, fmt.Sprintf("page_%d.pdf", i))

		if spec.IsBlank {
			// Create a 1-page blank PDF file
			err = os.WriteFile(tempPagePath, blankPDFBytes, 0644)
			if err != nil {
				return fmt.Errorf("failed to write blank temp page: %w", err)
			}
		} else {
			// Identify source document data
			var srcBytes []byte
			if spec.Path != "" {
				srcBytes = a.openedFiles[spec.Path]
				if len(srcBytes) == 0 {
					// Fallback to read from disk directly
					srcBytes, err = os.ReadFile(spec.Path)
					if err != nil {
						return fmt.Errorf("failed to read source file from disk %s: %w", spec.Path, err)
					}
					a.openedFiles[spec.Path] = srcBytes
				}
			}

			if len(srcBytes) == 0 {
				return fmt.Errorf("source PDF bytes are empty for page %d of %s", spec.PageNumber, spec.Path)
			}

			// Write source to temp file for pdfcpu API access
			srcTempPath := filepath.Join(tempDir, fmt.Sprintf("src_%d.pdf", i))
			err = os.WriteFile(srcTempPath, srcBytes, 0644)
			if err != nil {
				return fmt.Errorf("failed to write temp source file: %w", err)
			}

			// Trim page to output only a single page PDF
			err = api.TrimFile(srcTempPath, tempPagePath, []string{strconv.Itoa(spec.PageNumber)}, nil)
			if err != nil {
				return fmt.Errorf("failed to trim page %d: %w", spec.PageNumber, err)
			}

			// Apply rotation if required
			if spec.Rotation != 0 {
				// Rotate temp page in-place
				err = api.RotateFile(tempPagePath, "", spec.Rotation, nil, nil)
				if err != nil {
					return fmt.Errorf("failed to rotate page: %w", err)
				}
			}
		}

		tempFiles = append(tempFiles, tempPagePath)
	}

	// Merge all temp files into the final destination
	err = api.MergeCreateFile(tempFiles, destPath, false, nil)
	if err != nil {
		return fmt.Errorf("failed to merge pages into final PDF: %w", err)
	}

	return nil
}

// Minimal 1-page A4 blank PDF document bytes
var blankPDFBytes = []byte{
	0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x31, 0x20, 0x30, 0x20, 0x6f, 0x62, 0x6a,
	0x0a, 0x3c, 0x3c, 0x2f, 0x54, 0x79, 0x70, 0x65, 0x2f, 0x43, 0x61, 0x74, 0x61, 0x6c, 0x6f, 0x67,
	0x2f, 0x50, 0x61, 0x67, 0x65, 0x73, 0x20, 0x32, 0x20, 0x30, 0x20, 0x52, 0x3e, 0x3e, 0x0a, 0x65,
	0x6e, 0x64, 0x6f, 0x62, 0x6a, 0x0a, 0x32, 0x20, 0x30, 0x20, 0x6f, 0x62, 0x6a, 0x0a, 0x3c, 0x3c,
	0x2f, 0x54, 0x79, 0x70, 0x65, 0x2f, 0x50, 0x61, 0x67, 0x65, 0x73, 0x2f, 0x4b, 0x69, 0x64, 0x75,
	0x20, 0x5b, 0x33, 0x20, 0x30, 0x20, 0x52, 0x5d, 0x2f, 0x43, 0x6f, 0x75, 0x6e, 0x74, 0x20, 0x31,
	0x3e, 0x3e, 0x0a, 0x65, 0x6e, 0x64, 0x6f, 0x62, 0x6a, 0x0a, 0x33, 0x20, 0x30, 0x20, 0x6f, 0x62,
	0x6a, 0x0a, 0x3c, 0x3c, 0x2f, 0x54, 0x79, 0x70, 0x65, 0x2f, 0x50, 0x61, 0x67, 0x65, 0x2f, 0x50,
	0x61, 0x72, 0x65, 0x6e, 0x74, 0x20, 0x32, 0x20, 0x30, 0x20, 0x52, 0x2f, 0x4d, 0x65, 0x64, 0x69,
	0x61, 0x42, 0x6f, 0x78, 0x20, 0x5b, 0x30, 0x20, 0x30, 0x20, 0x35, 0x39, 0x35, 0x20, 0x38, 0x34,
	0x32, 0x5d, 0x2f, 0x52, 0x65, 0x73, 0x6f, 0x75, 0x72, 0x63, 0x65, 0x73, 0x20, 0x3c, 0x3c, 0x3e,
	0x3e, 0x3e, 0x3e, 0x0a, 0x65, 0x6e, 0x64, 0x6f, 0x62, 0x6a, 0x0a, 0x78, 0x72, 0x65, 0x66, 0x0a,
	0x30, 0x20, 0x34, 0x0a, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x20, 0x36,
	0x35, 0x35, 0x35, 0x35, 0x20, 0x66, 0x20, 0x0a, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30,
	0x31, 0x35, 0x20, 0x30, 0x30, 0x30, 0x30, 0x30, 0x20, 0x6e, 0x20, 0x0a, 0x30, 0x30, 0x30, 0x30,
	0x30, 0x30, 0x30, 0x30, 0x36, 0x38, 0x20, 0x30, 0x30, 0x30, 0x30, 0x30, 0x20, 0x6e, 0x20, 0x0a,
	0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x31, 0x32, 0x31, 0x20, 0x30, 0x30, 0x30, 0x30, 0x30,
	0x20, 0x6e, 0x20, 0x0a, 0x74, 0x72, 0x61, 0x66, 0x6c, 0x65, 0x72, 0x0a, 0x3c, 0x3c, 0x2f, 0x53,
	0x69, 0x7a, 0x65, 0x20, 0x34, 0x2f, 0x52, 0x6f, 0x6f, 0x74, 0x20, 0x31, 0x20, 0x30, 0x20, 0x52,
	0x3e, 0x3e, 0x0a, 0x73, 0x74, 0x61, 0x72, 0x74, 0x78, 0x72, 0x65, 0x66,
	0x0a, 0x32, 0x31, 0x33,
	0x0a, 0x25, 0x25, 0x45, 0x4f, 0x46,
}

// CompressPDF compresses/optimizes the PDF file at srcPath and writes to destPath
func (a *App) CompressPDF(srcPath, destPath string) error {
	return api.OptimizeFile(srcPath, destPath, nil)
}

// ProtectPDF encrypts the PDF at srcPath using AES-256 with user/owner passwords and writes to destPath
func (a *App) ProtectPDF(srcPath, destPath, userPW, ownerPW string) error {
	conf := model.NewAESConfiguration(userPW, ownerPW, 256)
	return api.EncryptFile(srcPath, destPath, conf)
}

// DecryptPDF decrypts a password-protected PDF at srcPath using the given password and writes to destPath
func (a *App) DecryptPDF(srcPath, destPath, password string) error {
	conf := model.NewDefaultConfiguration()
	conf.UserPW = password
	conf.OwnerPW = password
	return api.DecryptFile(srcPath, destPath, conf)
}

// AddTextWatermark applies a text watermark to srcPath and writes to destPath
func (a *App) AddTextWatermark(srcPath, destPath, text, desc string, onTop bool) error {
	wm, err := pdfcpu.ParseTextWatermarkDetails(text, desc, onTop, types.POINTS)
	if err != nil {
		return fmt.Errorf("failed to parse watermark configuration: %w", err)
	}
	return api.AddWatermarksFile(srcPath, destPath, nil, wm, nil)
}

// ImagesToPDF compiles the selected image paths into a PDF document at destPath
func (a *App) ImagesToPDF(imagePaths []string, destPath string) error {
	return api.ImportImagesFile(imagePaths, destPath, nil, nil)
}

// SelectMultipleImages opens a file dialog to select multiple PNG/JPG image files
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

// SaveBase64ToFile decodes raw base64 image data and writes it directly to disk
func (a *App) SaveBase64ToFile(base64Data, destPath string) error {
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return fmt.Errorf("failed to decode base64 data: %w", err)
	}
	return os.WriteFile(destPath, data, 0644)
}
