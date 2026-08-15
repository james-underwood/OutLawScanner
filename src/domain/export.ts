import type { CountEvent, ReconciliationReport } from './types';

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  // CRLF + a trailing newline: Excel is the actual consumer of this file.
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/**
 * The v1 write-back path. Keyed on Metrc package label so it can be diffed
 * against the POS or handed to whichever system owns the Metrc write.
 * Deliberately excludes matches — the file is a work list, not a dump.
 */
export function discrepancyCsv(report: ReconciliationReport): string {
  const rows = report.rows
    .filter((row) => row.classification !== 'match')
    .map((row) => [
      row.packageLabel,
      row.itemName,
      row.sku,
      row.expectedQuantity,
      row.countedQuantity ?? 'NOT COUNTED',
      row.countedQuantity === null ? '' : row.variance,
      row.unitOfMeasure,
      row.classification,
      row.method ?? '',
      row.confidence === null ? '' : row.confidence.toFixed(2),
      row.observedAt ? new Date(row.observedAt).toISOString() : '',
      row.unexpected ? 'UNEXPECTED' : '',
    ]);

  return toCsv(
    [
      'PackageLabel',
      'Item',
      'SKU',
      'ExpectedQuantity',
      'CountedQuantity',
      'Variance',
      'UnitOfMeasure',
      'Classification',
      'CountMethod',
      'Confidence',
      'ObservedAt',
      'Flag',
    ],
    rows,
  );
}

/** Full append-only event log, for the audit trail rather than for action. */
export function countEventCsv(events: CountEvent[]): string {
  return toCsv(
    [
      'EventId',
      'SessionId',
      'PackageLabel',
      'Method',
      'ObservedQuantity',
      'UnitOfMeasure',
      'Confidence',
      'ModelVersion',
      'DeviceId',
      'ObservedAt',
      'Shadow',
    ],
    events.map((e) => [
      e.id,
      e.sessionId,
      e.packageLabel,
      e.method,
      e.observedQuantity,
      e.unitOfMeasure,
      e.confidence ?? '',
      e.modelVersion ?? '',
      e.deviceId,
      new Date(e.observedAt).toISOString(),
      e.shadow ? 'shadow' : '',
    ]),
  );
}

export function reportSummary(report: ReconciliationReport): string {
  const counts = { match: 0, within_tolerance: 0, not_counted: 0, investigate: 0, reportable: 0 };
  for (const row of report.rows) counts[row.classification] += 1;

  const lines = [
    'OUTLAWSCANNER — INVENTORY AUDIT REPORT',
    '='.repeat(52),
    `Facility:     ${report.facilityLicense}`,
    `Zone:         ${report.zone ?? 'all'}`,
    `Session:      ${report.sessionId}`,
    `Generated:    ${new Date(report.generatedAt).toISOString()}`,
    '',
    `Packages counted:    ${report.countedPackages}`,
    `Packages not counted: ${report.uncountedPackages}`,
    '',
    `Matched:           ${counts.match}`,
    `Within tolerance:  ${counts.within_tolerance}`,
    `Investigate:       ${counts.investigate}`,
    `REPORTABLE:        ${counts.reportable}`,
    '',
  ];

  const escalations = report.rows.filter((r) => r.classification === 'reportable');
  if (escalations.length > 0) {
    lines.push(
      'REPORTABLE VARIANCES — these may carry a statutory reporting deadline.',
      '-'.repeat(52),
    );
    for (const row of escalations) {
      const sign = row.variance > 0 ? '+' : '';
      lines.push(
        `${row.packageLabel}  ${row.itemName}`,
        `    expected ${row.expectedQuantity} ${row.unitOfMeasure}` +
          `, counted ${row.countedQuantity ?? '—'}` +
          `  (${sign}${row.variance})${row.unexpected ? '  [NOT IN EXPECTED INVENTORY]' : ''}`,
      );
    }
    lines.push('');
  }

  lines.push(
    'This report is an observation record. It is not an adjustment and has not',
    'been written to Metrc. Adjustments must be reviewed and applied by an',
    'authorised person through the system of record.',
  );

  return lines.join('\n');
}
