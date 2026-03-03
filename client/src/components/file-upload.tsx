import { useState, useCallback, useRef } from "react";
import { Upload, FileAudio, X, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface FileUploadProps {
  onFileLoaded: (file: File) => void;
  isLoading: boolean;
  loadedFilename?: string;
  onClear: () => void;
}

export function FileUpload({ onFileLoaded, isLoading, loadedFilename, onClear }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    const ext = file.name.toLowerCase().split('.').pop();
    if (!['wav', 'txt', 'csv', 'dat'].includes(ext || '')) {
      return;
    }
    onFileLoaded(file);
  }, [onFileLoaded]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  if (loadedFilename) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50">
        <FileAudio className="w-4 h-4 text-primary shrink-0" />
        <span className="text-sm truncate flex-1" data-testid="text-loaded-filename">{loadedFilename}</span>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={onClear}
          data-testid="button-clear-file"
        >
          <X className="w-3 h-3" />
        </Button>
      </div>
    );
  }

  return (
    <div
      className={`
        relative border-2 border-dashed rounded-md p-6 text-center cursor-pointer
        transition-colors duration-150
        ${isDragging
          ? 'border-primary bg-primary/5'
          : 'border-muted-foreground/25 hover:border-muted-foreground/40'
        }
      `}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={() => inputRef.current?.click()}
      data-testid="dropzone-file-upload"
    >
      <input
        ref={inputRef}
        type="file"
        accept=".wav,.txt,.csv,.dat"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.[0]) handleFile(e.target.files[0]);
        }}
        data-testid="input-file-upload"
      />
      {isLoading ? (
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Processing file...</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <Upload className="w-8 h-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Drop an IR file here or click to browse
          </p>
          <p className="text-xs text-muted-foreground/70">
            WAV, TXT, CSV, DAT
          </p>
        </div>
      )}
    </div>
  );
}
