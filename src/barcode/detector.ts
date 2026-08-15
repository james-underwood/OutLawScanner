/**
 * Package identity. This half of the workflow already works today — the
 * operator scans a label and the device knows which Metrc package is in front
 * of them — so this wrapper exists only to keep it working across platforms.
 *
 * Uses the native BarcodeDetector where present (Chrome/Android). iOS Safari
 * does not expose it, so a keyboard-wedge path is kept for hardware scanners
 * and manual label entry is always available. A WASM decoder can slot in behind
 * this same interface without touching callers.
 */

export interface DetectedBarcode {
  value: string;
  format: string;
}

const FORMATS = ['code_128', 'code_39', 'qr_code', 'data_matrix', 'ean_13', 'upc_a'];

export function isNativeDetectorAvailable(): boolean {
  return typeof globalThis !== 'undefined' && 'BarcodeDetector' in globalThis;
}

export class BarcodeScanner {
  private detector: unknown = null;

  async init(): Promise<boolean> {
    if (!isNativeDetectorAvailable()) return false;
    const Ctor = (globalThis as Record<string, unknown>)['BarcodeDetector'] as new (
      opts: { formats: string[] },
    ) => unknown;
    this.detector = new Ctor({ formats: FORMATS });
    return true;
  }

  /**
   * Decodes every barcode in the frame, not just the first. On a shelf of
   * individually labelled units this turns one camera pass into many identity
   * reads, which is where the scanning time actually goes.
   */
  async detect(source: CanvasImageSource): Promise<DetectedBarcode[]> {
    if (!this.detector) return [];
    const detect = (this.detector as { detect: (s: CanvasImageSource) => Promise<unknown[]> })
      .detect;
    const results = await detect.call(this.detector, source);
    return results.map((r) => {
      const barcode = r as { rawValue: string; format: string };
      return { value: barcode.rawValue, format: barcode.format };
    });
  }
}

/** Metrc UIDs are 24 characters, uppercase alphanumeric. */
const METRC_UID = /^[0-9A-Z]{24}$/;

export function looksLikeMetrcLabel(value: string): boolean {
  return METRC_UID.test(value.trim().toUpperCase());
}

/**
 * Hardware barcode guns present as keyboards: a burst of keypresses terminated
 * by Enter. Distinguishing that from human typing is purely a matter of speed.
 */
export function attachWedgeListener(
  target: HTMLElement | Document,
  onScan: (value: string) => void,
  maxGapMs = 40,
): () => void {
  let buffer = '';
  let lastKeyAt = 0;

  const handler = (event: Event): void => {
    const key = (event as KeyboardEvent).key;
    const now = Date.now();
    if (now - lastKeyAt > maxGapMs) buffer = '';
    lastKeyAt = now;

    if (key === 'Enter') {
      if (buffer.length >= 6) onScan(buffer);
      buffer = '';
      return;
    }
    if (key.length === 1) buffer += key;
  };

  target.addEventListener('keydown', handler);
  return () => target.removeEventListener('keydown', handler);
}
