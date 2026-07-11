package pdfservice

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strconv"

	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

// PageSpec defines page parameters for layout export
type PageSpec struct {
	Path       string `json:"path"`
	PageNumber int    `json:"pageNumber"`
	Rotation   int    `json:"rotation"`
	IsBlank    bool   `json:"isBlank"`
}

// ExportSegment groups sequential pages from the same document with identical rotations
type ExportSegment struct {
	Path      string
	PageRange []string
	Rotation  int
	IsBlank   bool
}

// ExportPDF compiles the final PDF document by slicing, rotating, and merging source pages efficiently
func ExportPDF(sequence []PageSpec, destPath string) error {
	tempDir, err := os.MkdirTemp("", "pdfication_export_*")
	if err != nil {
		return fmt.Errorf("failed to create temp dir: %w", err)
	}
	defer os.RemoveAll(tempDir)

	// Group sequential page specifications into optimized segments
	var segments []ExportSegment
	for _, spec := range sequence {
		if spec.IsBlank {
			segments = append(segments, ExportSegment{IsBlank: true})
			continue
		}

		// Merge with last segment if same file and rotation
		if len(segments) > 0 {
			last := &segments[len(segments)-1]
			if !last.IsBlank && last.Path == spec.Path && last.Rotation == spec.Rotation {
				last.PageRange = append(last.PageRange, strconv.Itoa(spec.PageNumber))
				continue
			}
		}

		// Start new segment
		segments = append(segments, ExportSegment{
			Path:      spec.Path,
			PageRange: []string{strconv.Itoa(spec.PageNumber)},
			Rotation:  spec.Rotation,
			IsBlank:   false,
		})
	}

	var tempFiles []string
	for i, seg := range segments {
		tempSegmentPath := filepath.Join(tempDir, fmt.Sprintf("segment_%d.pdf", i))

		if seg.IsBlank {
			// Write 1-page blank PDF
			err = os.WriteFile(tempSegmentPath, blankPDFBytes, 0644)
			if err != nil {
				return fmt.Errorf("failed to write blank temp page: %w", err)
			}
		} else {
			// Trim segment pages in one call directly from source path
			err = api.TrimFile(seg.Path, tempSegmentPath, seg.PageRange, nil)
			if err != nil {
				return fmt.Errorf("failed to trim pages %v from %s: %w", seg.PageRange, seg.Path, err)
			}

			// Rotate segment if required
			if seg.Rotation != 0 {
				err = api.RotateFile(tempSegmentPath, "", seg.Rotation, nil, nil)
				if err != nil {
					return fmt.Errorf("failed to rotate segment %d: %w", i, err)
				}
			}
		}

		tempFiles = append(tempFiles, tempSegmentPath)
	}

	// Merge segment files into target
	err = api.MergeCreateFile(tempFiles, destPath, false, nil)
	if err != nil {
		return fmt.Errorf("failed to merge segments into final PDF: %w", err)
	}

	return nil
}

// Compress optimizes PDF resources and shrinks structure size
func Compress(srcPath, destPath string) error {
	return api.OptimizeFile(srcPath, destPath, nil)
}

// Protect encrypts document with user and owner passwords and applies print/copy rules
func Protect(srcPath, destPath, userPW, ownerPW string, allowPrint, allowCopy bool) error {
	conf := model.NewAESConfiguration(userPW, ownerPW, 256)

	// Standard PDF permission flags: print (bit 3), copy (bit 5)
	permissions := 61635
	if !allowPrint {
		permissions &^= (1 << 2)
	}
	if !allowCopy {
		permissions &^= (1 << 4)
	}
	conf.Permissions = model.PermissionFlags(permissions)

	return api.EncryptFile(srcPath, destPath, conf)
}

// Decrypt removes password protection and security restrictions
func Decrypt(srcPath, destPath, password string) error {
	conf := model.NewDefaultConfiguration()
	conf.UserPW = password
	conf.OwnerPW = password
	return api.DecryptFile(srcPath, destPath, conf)
}

// Watermark stamps a custom text overlay on document pages
func Watermark(srcPath, destPath, text, desc string, onTop bool) error {
	return api.AddTextWatermarksFile(srcPath, destPath, nil, onTop, text, desc, nil)
}

// RemoveAnnotations wipes all text markups, shapes, comments, and links
func RemoveAnnotations(srcPath, destPath string) error {
	return api.RemoveAnnotationsFile(srcPath, destPath, nil, nil, nil, nil, false)
}

// ListAttachments returns a slice of file attachment names present in the PDF
func ListAttachments(srcPath string) ([]string, error) {
	file, err := os.Open(srcPath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	attachments, err := api.Attachments(file, nil)
	if err != nil {
		return []string{}, nil
	}

	var names []string
	for _, att := range attachments {
		names = append(names, att.FileName)
	}
	return names, nil
}

// RemoveAttachments deletes specified file attachments from the PDF
func RemoveAttachments(srcPath, destPath string, files []string) error {
	return api.RemoveAttachmentsFile(srcPath, destPath, files, nil)
}

// RemoveMetadata clears standard document properties info keys
func RemoveMetadata(srcPath, destPath string) error {
	properties := []string{"Title", "Author", "Subject", "Keywords", "Creator", "Producer", "CreationDate", "ModDate"}
	return api.RemovePropertiesFile(srcPath, destPath, properties, nil)
}

// ImagesToPDF compiles images into a single PDF document
func ImagesToPDF(imagePaths []string, destPath string) error {
	return api.ImportImagesFile(imagePaths, destPath, nil, nil)
}

// FlattenDocument compiles page base64 images into a flat image-only PDF
func FlattenDocument(pageBase64s []string, destPath string) error {
	tempDir, err := os.MkdirTemp("", "pdfication_flatten_*")
	if err != nil {
		return fmt.Errorf("failed to create temp dir: %w", err)
	}
	defer os.RemoveAll(tempDir)

	var tempImagePaths []string
	for i, base64Data := range pageBase64s {
		data, err := base64.StdEncoding.DecodeString(base64Data)
		if err != nil {
			return fmt.Errorf("failed to decode base64 page %d: %w", i+1, err)
		}

		tempPath := filepath.Join(tempDir, fmt.Sprintf("page_%d.png", i+1))
		err = os.WriteFile(tempPath, data, 0644)
		if err != nil {
			return fmt.Errorf("failed to write temp page image %d: %w", i+1, err)
		}

		tempImagePaths = append(tempImagePaths, tempPath)
	}

	return api.ImportImagesFile(tempImagePaths, destPath, nil, nil)
}

// Minimal 1-page A4 blank PDF document bytes
var blankPDFBytes = []byte{
	0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x31, 0x20, 0x30, 0x20, 0x6f, 0x62, 0x6a,
	0x0a, 0x3c, 0x3c, 0x2f, 0x54, 0x79, 0x70, 0x65, 0x2f, 0x43, 0x61, 0x74, 0x61, 0x6c, 0x6f, 0x67,
	0x2f, 0x50, 0x61, 0x67, 0x65, 0x73, 0x20, 0x32, 0x20, 0x30, 0x20, 0x52, 0x3e, 0x3e, 0x0a, 0x65,
	0x6e, 0x64, 0x6f, 0x62, 0x6a, 0x0a, 0x32, 0x20, 0x30, 0x20, 0x6f, 0x62, 0x6a, 0x0a, 0x3c, 0x3c,
	0x2f, 0x54, 0x79, 0x70, 0x65, 0x2f, 0x50, 0x61, 0x67, 0x65, 0x73, 0x2f, 0x4b, 0x69, 0x64, 0x73,
	0x5b, 0x33, 0x20, 0x30, 0x20, 0x52, 0x5d, 0x2f, 0x43, 0x6f, 0x75, 0x6e, 0x74, 0x20, 0x31, 0x3e,
	0x3e, 0x0a, 0x65, 0x6e, 0x64, 0x6f, 0x62, 0x6a, 0x0a, 0x33, 0x20, 0x30, 0x20, 0x6f, 0x62, 0x6a,
	0x0a, 0x3c, 0x3c, 0x2f, 0x54, 0x79, 0x70, 0x65, 0x2f, 0x50, 0x61, 0x67, 0x65, 0x2f, 0x50, 0x61,
	0x72, 0x65, 0x6e, 0x74, 0x20, 0x32, 0x20, 0x30, 0x20, 0x52, 0x2f, 0x4d, 0x65, 0x64, 0x69, 0x61,
	0x42, 0x6f, 0x78, 0x5b, 0x30, 0x20, 0x30, 0x20, 0x35, 0x39, 0x35, 0x20, 0x38, 0x34, 0x32, 0x5d,
	0x2f, 0x52, 0x65, 0x73, 0x6f, 0x75, 0x72, 0x63, 0x65, 0x73, 0x3c, 0x3c, 0x3e, 0x3e, 0x3e, 0x3e,
	0x0a, 0x65, 0x6e, 0x64, 0x6f, 0x62, 0x6a, 0x0a, 0x78, 0x72, 0x65, 0x66, 0x0a, 0x30, 0x20, 0x34,
	0x0a, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x20, 0x36, 0x35, 0x35, 0x33,
	0x35, 0x20, 0x66, 0x0a, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x39, 0x20, 0x30,
	0x30, 0x30, 0x30, 0x30, 0x20, 0x6e, 0x0a, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x37,
	0x34, 0x20, 0x30, 0x30, 0x30, 0x30, 0x30, 0x20, 0x6e, 0x0a, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30,
	0x30, 0x31, 0x34, 0x35, 0x20, 0x30, 0x30, 0x30, 0x30, 0x30, 0x20, 0x6e, 0x0a, 0x74, 0x72, 0x61,
	0x69, 0x6c, 0x65, 0x72, 0x0a, 0x3c, 0x3c, 0x2f, 0x53, 0x69, 0x7a, 0x65, 0x20, 0x34, 0x2f, 0x52,
	0x6f, 0x6f, 0x74, 0x20, 0x31, 0x20, 0x30, 0x20, 0x52, 0x3e, 0x3e, 0x0a, 0x73, 0x74, 0x61, 0x72,
	0x74, 0x78, 0x72, 0x65, 0x66, 0x0a, 0x32, 0x35, 0x31, 0x0a, 0x25, 0x25, 0x45, 0x4f, 0x46,
}
