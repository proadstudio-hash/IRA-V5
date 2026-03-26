import html2canvas from "html2canvas";

export interface CaptureResult {
  dataUrl: string;
  width: number;
  height: number;
}

const defaultOpts = {
  backgroundColor: "#ffffff",
  scale: 2,
  logging: false,
  useCORS: true,
  removeContainer: true,
  allowTaint: true,
  imageTimeout: 5000,
};

export async function captureElementAsImage(element: HTMLElement): Promise<string> {
  const canvas = await html2canvas(element, defaultOpts);
  const dataUrl = canvas.toDataURL("image/png");
  canvas.width = 0;
  canvas.height = 0;
  return dataUrl;
}

export async function captureElementWithDims(element: HTMLElement): Promise<CaptureResult> {
  const canvas = await html2canvas(element, defaultOpts);
  const width = canvas.width;
  const height = canvas.height;
  const dataUrl = canvas.toDataURL("image/png");
  canvas.width = 0;
  canvas.height = 0;
  return { dataUrl, width, height };
}

function yieldToMain(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

export async function batchCapture(
  entries: [string, () => HTMLElement | null][],
  concurrency: number = 3
): Promise<Record<string, CaptureResult>> {
  const results: Record<string, CaptureResult> = {};

  for (let i = 0; i < entries.length; i += concurrency) {
    const batch = entries.slice(i, i + concurrency);
    const promises = batch.map(async ([key, getter]) => {
      const el = getter();
      if (!el) return null;
      try {
        const result = await captureElementWithDims(el);
        return { key, result };
      } catch {
        return null;
      }
    });
    const settled = await Promise.all(promises);
    for (const item of settled) {
      if (item) results[item.key] = item.result;
    }
    if (i + concurrency < entries.length) {
      await yieldToMain();
    }
  }

  return results;
}

export async function captureElementAsBlob(element: HTMLElement): Promise<Uint8Array> {
  const canvas = await html2canvas(element, defaultOpts);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      canvas.width = 0;
      canvas.height = 0;
      if (!blob) { reject(new Error("Failed to create blob")); return; }
      blob.arrayBuffer().then(buf => resolve(new Uint8Array(buf))).catch(reject);
    }, "image/png");
  });
}

export function getImageDimensions(element: HTMLElement): { width: number; height: number } {
  const rect = element.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}
