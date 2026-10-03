import JSZip from 'jszip';
import type { FrameworkFileSet } from '../services/frameworkGenerator';

export function createFrameworkZip(files: FrameworkFileSet): JSZip {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) {
    zip.file(`playwright-framework/${path}`, content);
  }
  return zip;
}

export async function downloadFrameworkZip(files: FrameworkFileSet): Promise<void> {
  const blob = await createFrameworkZip(files).generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  try {
    anchor.href = url;
    anchor.download = 'playwright-framework.zip';
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
