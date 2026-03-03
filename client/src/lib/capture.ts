import html2canvas from "html2canvas";

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
  return canvas.toDataURL("image/png");
}

export async function captureElementAsBlob(element: HTMLElement): Promise<Uint8Array> {
  const canvas = await html2canvas(element, defaultOpts);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error("Failed to create blob")); return; }
      blob.arrayBuffer().then(buf => resolve(new Uint8Array(buf))).catch(reject);
    }, "image/png");
  });
}

export function getImageDimensions(element: HTMLElement): { width: number; height: number } {
  const rect = element.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}
