import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, X, FileText, Image, File, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DocumentType, DOCUMENT_TYPE_CONFIG } from '@/types/deal';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

interface UploadedFile {
  file: File;
  type: DocumentType;
  preview?: string;
}

interface DocumentUploadProps {
  onUpload?: (files: UploadedFile[]) => void;
}

export function DocumentUpload({ onUpload }: DocumentUploadProps) {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newFiles: UploadedFile[] = acceptedFiles.map((file) => ({
      file,
      type: 'other' as DocumentType,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
    }));
    setUploadedFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'image/*': ['.jpg', '.jpeg', '.png'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    },
    maxSize: 10 * 1024 * 1024, // 10MB
  });

  const removeFile = (index: number) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const updateFileType = (index: number, type: DocumentType) => {
    setUploadedFiles((prev) =>
      prev.map((f, i) => (i === index ? { ...f, type } : f))
    );
  };

  const handleSubmit = () => {
    if (uploadedFiles.length === 0) return;
    onUpload?.(uploadedFiles);
    toast({
      title: 'Documents Uploaded',
      description: `${uploadedFiles.length} document(s) uploaded successfully.`,
    });
    setUploadedFiles([]);
  };

  const getFileIcon = (file: File) => {
    if (file.type.startsWith('image/')) return <Image className="h-5 w-5 text-info" />;
    if (file.type === 'application/pdf') return <FileText className="h-5 w-5 text-destructive" />;
    return <File className="h-5 w-5 text-muted-foreground" />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-4">
      {/* Drop Zone */}
      <div
        {...getRootProps()}
        className={cn(
          'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
          isDragActive
            ? 'border-accent bg-accent/5'
            : 'border-border hover:border-muted-foreground/50'
        )}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Upload className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <p className="font-medium">
              {isDragActive ? 'Drop files here...' : 'Drag & drop files here'}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              or click to browse. Supports PDF, JPG, PNG, DOC, DOCX (max 10MB)
            </p>
          </div>
        </div>
      </div>

      {/* Uploaded Files List */}
      {uploadedFiles.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium">
            {uploadedFiles.length} file(s) ready to upload
          </p>
          {uploadedFiles.map((item, index) => (
            <div
              key={index}
              className="flex items-center gap-3 p-3 rounded-lg border bg-card"
            >
              {/* Preview/Icon */}
              <div className="flex h-10 w-10 items-center justify-center rounded bg-muted shrink-0">
                {item.preview ? (
                  <img
                    src={item.preview}
                    alt=""
                    className="h-full w-full object-cover rounded"
                  />
                ) : (
                  getFileIcon(item.file)
                )}
              </div>

              {/* File Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{item.file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(item.file.size)}
                </p>
              </div>

              {/* Type Selector */}
              <Select
                value={item.type}
                onValueChange={(value) => updateFileType(index, value as DocumentType)}
              >
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(DOCUMENT_TYPE_CONFIG).map(([key, config]) => (
                    <SelectItem key={key} value={key}>
                      {config.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Remove Button */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeFile(index)}
                className="shrink-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}

          <Button onClick={handleSubmit} className="w-full">
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Upload {uploadedFiles.length} Document(s)
          </Button>
        </div>
      )}
    </div>
  );
}
