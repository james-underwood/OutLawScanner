import type { ExpectedInventory, UnitOfMeasure } from '../domain/types';
import { db, newId, type ScannerDb } from './schema';

/**
 * Expected inventory normally arrives from a read-only sync against Metrc or
 * the POS. Until that integration exists, it is imported from a CSV export —
 * which is also the fastest way to trial this against a real vault without
 * waiting on vendor API access.
 *
 * Expected headers (case-insensitive):
 *   PackageLabel, Item, SKU, Quantity, UnitOfMeasure, UnitWeightG, Zone
 */
export function parseInventoryCsv(text: string, facilityLicense: string): ExpectedInventory[] {
  const rows = parseCsv(text);
  const header = rows.shift();
  if (!header) return [];

  const index = new Map(header.map((h, i) => [h.trim().toLowerCase(), i]));
  const at = (row: string[], name: string): string =>
    (index.has(name) ? row[index.get(name)!] : '')?.trim() ?? '';

  const now = Date.now();
  const parsed: ExpectedInventory[] = [];

  for (const row of rows) {
    const packageLabel = at(row, 'packagelabel') || at(row, 'label');
    if (!packageLabel) continue;

    const uom = at(row, 'unitofmeasure').toLowerCase();
    const unitWeight = Number(at(row, 'unitweightg'));

    parsed.push({
      id: newId(),
      facilityLicense,
      packageLabel: packageLabel.toUpperCase(),
      itemName: at(row, 'item') || at(row, 'itemname') || '(unnamed)',
      sku: at(row, 'sku') || null,
      quantity: Number(at(row, 'quantity')) || 0,
      unitOfMeasure: normaliseUom(uom),
      unitWeightG: Number.isFinite(unitWeight) && unitWeight > 0 ? unitWeight : null,
      unitFootprintPx: null,
      zone: at(row, 'zone') || null,
      source: 'import',
      syncedAt: now,
    });
  }

  return parsed;
}

function normaliseUom(value: string): UnitOfMeasure {
  return value.startsWith('g') ? 'Grams' : 'Each';
}

/** Minimal RFC 4180 reader — handles quoted fields and embedded commas. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') field += char;
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

export async function replaceExpectedInventory(
  facilityLicense: string,
  items: ExpectedInventory[],
  database: ScannerDb = db,
): Promise<number> {
  await database.transaction('rw', database.expected, async () => {
    await database.expected.where('facilityLicense').equals(facilityLicense).delete();
    await database.expected.bulkAdd(items);
  });
  return items.length;
}

/** Demo data, so the app is explorable without a vault attached. */
export const DEMO_LICENSE = 'DEMO-RETAIL-0001';

export function demoInventory(): ExpectedInventory[] {
  const now = Date.now();
  const rows: [string, string, string, number, UnitOfMeasure, number | null, string][] = [
    ['1A4FF0100000022000000101', 'Blue Dream · 3.5g Jar', 'BD-35', 24, 'Each', 12.4, 'vault-a'],
    ['1A4FF0100000022000000102', 'Sour Diesel · 1g Cart', 'SD-CART', 40, 'Each', 18.2, 'vault-a'],
    ['1A4FF0100000022000000103', 'House Pre-Roll · 1g', 'HPR-1', 96, 'Each', 2.1, 'vault-a'],
    ['1A4FF0100000022000000104', 'Gummies 10mg · 10pk', 'GUM-10', 32, 'Each', 55.0, 'vault-a'],
    ['1A4FF0100000022000000105', 'Bulk Flower · Wedding Cake', 'BULK-WC', 453.6, 'Grams', null, 'vault-b'],
    ['1A4FF0100000022000000106', 'Bulk Flower · Gelato', 'BULK-GEL', 226.8, 'Grams', null, 'vault-b'],
    ['1A4FF0100000022000000107', 'Live Resin · 1g', 'LR-1', 18, 'Each', 9.8, 'floor-display-1'],
    ['1A4FF0100000022000000108', 'CBD Tincture · 30ml', 'TINC-30', 12, 'Each', 92.0, 'floor-display-1'],
  ];

  return rows.map(([packageLabel, itemName, sku, quantity, unitOfMeasure, unitWeightG, zone]) => ({
    id: newId(),
    facilityLicense: DEMO_LICENSE,
    packageLabel,
    itemName,
    sku,
    quantity,
    unitOfMeasure,
    unitWeightG,
    unitFootprintPx: null,
    zone,
    source: 'import' as const,
    syncedAt: now,
  }));
}
