import type { CountResult, ObserverHandle, StreamingCountSource } from './CountSource';
import type { ExpectedInventory } from '../domain/types';

/**
 * Bluetooth counting scale.
 *
 * Deliberately the first automated source to ship. It needs no training data,
 * no lighting, and no line of sight, so it works on exactly the goods where the
 * camera fails — stacked, bagged, boxed, or inside a closed jar — and it reads
 * grams natively, which is the half of the vault a piece count structurally
 * cannot serve.
 *
 * Supports two transports, because cheap scales are not standardised:
 *   1. Bluetooth SIG Weight Scale Service (0x181D) — proper GATT measurements.
 *   2. Nordic UART Service — ASCII lines like "  123.45 g", which is what most
 *      inexpensive bench scales actually emit.
 */

const WEIGHT_SCALE_SERVICE = 0x181d;
const WEIGHT_MEASUREMENT_CHAR = 0x2a9d;
const NORDIC_UART_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NORDIC_UART_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

export interface ScaleReading {
  grams: number;
  /** Scales flag when the reading has settled; an unsettled value must not be committed. */
  stable: boolean;
}

export interface ScaleTransport {
  connect(): Promise<void>;
  disconnect(): void;
  onReading(handler: (reading: ScaleReading) => void): void;
  readonly connected: boolean;
}

export class WebBluetoothScale implements ScaleTransport {
  private device: BluetoothDevice | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private handler: ((reading: ScaleReading) => void) | null = null;
  private readonly decoder = new TextDecoder();
  private buffer = '';

  get connected(): boolean {
    return this.device?.gatt?.connected ?? false;
  }

  onReading(handler: (reading: ScaleReading) => void): void {
    this.handler = handler;
  }

  async connect(): Promise<void> {
    if (!navigator.bluetooth) throw new Error('Web Bluetooth is not available on this device');

    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [WEIGHT_SCALE_SERVICE] }, { services: [NORDIC_UART_SERVICE] }],
      optionalServices: [WEIGHT_SCALE_SERVICE, NORDIC_UART_SERVICE],
    });

    const server = await this.device.gatt?.connect();
    if (!server) throw new Error('Could not connect to scale');

    this.characteristic = await this.resolveCharacteristic(server);
    await this.characteristic.startNotifications();
    this.characteristic.addEventListener('characteristicvaluechanged', this.handleValue);
  }

  private async resolveCharacteristic(
    server: BluetoothRemoteGATTServer,
  ): Promise<BluetoothRemoteGATTCharacteristic> {
    try {
      const service = await server.getPrimaryService(WEIGHT_SCALE_SERVICE);
      return await service.getCharacteristic(WEIGHT_MEASUREMENT_CHAR);
    } catch {
      const service = await server.getPrimaryService(NORDIC_UART_SERVICE);
      return await service.getCharacteristic(NORDIC_UART_TX);
    }
  }

  private readonly handleValue = (event: Event): void => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!value || !this.handler) return;

    const standard = parseWeightMeasurement(value);
    if (standard) {
      this.handler(standard);
      return;
    }

    // UART transports split lines arbitrarily across notifications.
    this.buffer += this.decoder.decode(value.buffer);
    const lines = this.buffer.split(/[\r\n]+/);
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      const reading = parseAsciiWeight(line);
      if (reading) this.handler(reading);
    }
  };

  disconnect(): void {
    this.characteristic?.removeEventListener('characteristicvaluechanged', this.handleValue);
    this.device?.gatt?.disconnect();
    this.device = null;
    this.characteristic = null;
    this.buffer = '';
  }
}

/** Bluetooth SIG Weight Measurement characteristic (0x2A9D). */
export function parseWeightMeasurement(view: DataView): ScaleReading | null {
  if (view.byteLength < 3) return null;
  const flags = view.getUint8(0);
  const imperial = (flags & 0x01) !== 0;
  const raw = view.getUint16(1, true);
  // Resolution per spec: 5 g per LSB metric, 0.01 lb imperial.
  const grams = imperial ? raw * 0.01 * 453.59237 : raw * 5;
  return { grams, stable: true };
}

/** ASCII bench-scale output, e.g. "ST,GS,   123.45 g" or "  12.3g". */
export function parseAsciiWeight(line: string): ScaleReading | null {
  const match = /(-?\d+(?:\.\d+)?)\s*(kg|g|lb|oz)\b/i.exec(line);
  if (!match) return null;

  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;

  const grams = value * UNIT_TO_GRAMS[match[2]!.toLowerCase() as keyof typeof UNIT_TO_GRAMS];
  // "US" is the common marker for an unstable reading; "ST" for stable. Absent
  // any marker we assume stable, since many scales only transmit settled values.
  const stable = !/\bUS\b/i.test(line);
  return { grams, stable };
}

const UNIT_TO_GRAMS = { g: 1, kg: 1000, lb: 453.59237, oz: 28.349523125 } as const;

export interface ScaleCountOptions {
  /** Tare weight of the container, in grams. */
  tareG: number;
  /**
   * How close the remainder must sit to a whole unit to be trusted. Unit weight
   * varies with tare and moisture, so a reading that does not land near an
   * integer multiple is reported at low confidence rather than rounded away.
   */
  integerTolerance: number;
}

export const DEFAULT_SCALE_OPTIONS: ScaleCountOptions = { tareG: 0, integerTolerance: 0.15 };

export function weightToCount(
  grams: number,
  unitWeightG: number,
  options: ScaleCountOptions = DEFAULT_SCALE_OPTIONS,
): { quantity: number; confidence: number } {
  const net = grams - options.tareG;
  if (unitWeightG <= 0) return { quantity: 0, confidence: 0 };
  if (net <= 0) return { quantity: 0, confidence: net === 0 ? 0.95 : 0 };

  const exact = net / unitWeightG;
  const quantity = Math.round(exact);
  const residual = Math.abs(exact - quantity);

  // Confidence decays linearly to zero at the tolerance boundary; past it the
  // reading disagrees with the SKU's known unit weight and must not auto-fill.
  const confidence = residual > options.integerTolerance
    ? 0
    : 1 - residual / options.integerTolerance;

  return { quantity: Math.max(0, quantity), confidence };
}

export class ScaleCountSource implements StreamingCountSource {
  readonly method = 'scale' as const;
  readonly label = 'Bluetooth scale';

  constructor(
    private readonly transport: ScaleTransport,
    private options: ScaleCountOptions = DEFAULT_SCALE_OPTIONS,
  ) {}

  setOptions(options: Partial<ScaleCountOptions>): void {
    this.options = { ...this.options, ...options };
  }

  async isAvailable(): Promise<boolean> {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  /**
   * Gram-denominated packages are always supported — the scale reads them
   * directly. Piece counts require a known unit weight, and refusing when it is
   * missing is the whole point: a guess here silently corrupts inventory.
   */
  supports(pkg: ExpectedInventory): boolean {
    return pkg.unitOfMeasure === 'Grams' || pkg.unitWeightG !== null;
  }

  async observe(
    pkg: ExpectedInventory,
    onUpdate: (result: CountResult & { settled: boolean }) => void,
  ): Promise<ObserverHandle> {
    if (!this.transport.connected) await this.transport.connect();

    this.transport.onReading(({ grams, stable }) => {
      if (pkg.unitOfMeasure === 'Grams') {
        const net = grams - this.options.tareG;
        onUpdate({
          quantity: Number(net.toFixed(2)),
          unitOfMeasure: 'Grams',
          confidence: stable ? 0.98 : 0.4,
          settled: stable,
          modelVersion: 'scale/direct',
        });
        return;
      }

      const { quantity, confidence } = weightToCount(grams, pkg.unitWeightG!, this.options);
      onUpdate({
        quantity,
        unitOfMeasure: 'Each',
        confidence: stable ? confidence : confidence * 0.4,
        settled: stable && confidence > 0,
        modelVersion: `scale/unit-weight@${pkg.unitWeightG}g`,
      });
    });

    return { stop: () => this.transport.disconnect() };
  }
}
