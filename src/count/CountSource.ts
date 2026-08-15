import type { ExpectedInventory, CountMethod, UnitOfMeasure } from '../domain/types';

export interface CountResult {
  quantity: number;
  unitOfMeasure: UnitOfMeasure;
  /** 0..1. Null only for manual entry. */
  confidence: number | null;
  evidence?: Blob | null;
  modelVersion?: string | null;
}

/**
 * Every counting modality implements this. The point of the abstraction is not
 * architectural tidiness — it is that no single modality covers the catalogue.
 * Cartridges in a tray want the camera; pre-rolls in a box want the scale; bulk
 * flower can only be weighed; anything unusual falls back to a human.
 *
 * `supports()` is what makes that routing happen at runtime, per package.
 */
export interface CountSource {
  readonly method: CountMethod;
  readonly label: string;
  /** Hardware/permission availability on this device. */
  isAvailable(): Promise<boolean>;
  /** Whether this source can meaningfully count *this* package. */
  supports(pkg: ExpectedInventory): boolean;
}

export interface ObserverHandle {
  stop(): void;
}

/** Sources that stream candidate counts until confirmed or cancelled. */
export interface StreamingCountSource extends CountSource {
  observe(
    pkg: ExpectedInventory,
    onUpdate: (result: CountResult & { settled: boolean }) => void,
  ): Promise<ObserverHandle>;
}

export function isStreaming(source: CountSource): source is StreamingCountSource {
  return 'observe' in source;
}
