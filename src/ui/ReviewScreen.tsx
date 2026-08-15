import { useState } from 'react';
import type { ReconciliationReport, CountEvent } from '../domain/types';
import { countEventCsv, discrepancyCsv, reportSummary } from '../domain/export';
import { download } from '../domain/download';

interface Props {
  report: ReconciliationReport;
  events: CountEvent[];
  onBack: () => void;
}

const CLASS_PILL = {
  match: 'ok',
  within_tolerance: 'ok',
  // An uncounted package is not a passing result — it never gets the green pill.
  not_counted: '',
  investigate: 'warn',
  reportable: 'bad',
} as const;

export function ReviewScreen({ report, events, onBack }: Props) {
  const reportable = report.rows.filter((r) => r.classification === 'reportable');
  const stamp = new Date(report.generatedAt).toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  // Never let an export fail silently: the file is the only thing this audit
  // produces, so the operator must know whether they actually got it.
  const save = async (filename: string, contents: string, mime?: string) => {
    setExportStatus(null);
    const outcome = await download(filename, contents, mime);
    setExportStatus(
      outcome === 'saved'
        ? `Saved ${filename}`
        : outcome === 'declined'
          ? 'Save cancelled.'
          : 'This viewer will not allow downloads. Open the app in a browser tab to export.',
    );
  };

  return (
    <>
      <div className="row spread" style={{ marginBottom: 14 }}>
        <button className="ghost" onClick={onBack}>← Back to count</button>
        <span className="small muted">{report.countedPackages} counted · {report.uncountedPackages} skipped</span>
      </div>

      {reportable.length > 0 && (
        <div className="banner bad">
          <strong>{reportable.length} reportable variance{reportable.length === 1 ? '' : 's'}.</strong>{' '}
          Significant loss or unexplained inventory may carry a statutory reporting
          deadline in your state. Route these to whoever owns compliance before
          adjusting anything.
        </div>
      )}

      <div className="card">
        <h2>Variances</h2>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Expected</th>
                <th className="num">Counted</th>
                <th className="num">Variance</th>
                <th className="hide-narrow">Method</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.packageLabel}>
                  <td className="item-cell">
                    <div className="truncate">{row.itemName}</div>
                    <div className="mono muted truncate">{row.packageLabel}</div>
                  </td>
                  <td className="num">{row.expectedQuantity}</td>
                  <td className="num">{row.countedQuantity ?? '—'}</td>
                  <td className="num">
                    {row.countedQuantity === null
                      ? '—'
                      : `${row.variance > 0 ? '+' : ''}${round(row.variance)}`}
                  </td>
                  <td className="small muted hide-narrow">
                    {row.method ?? '—'}
                    {row.confidence !== null && ` ${(row.confidence * 100).toFixed(0)}%`}
                  </td>
                  <td>
                    <span className={`pill ${CLASS_PILL[row.classification]}`}>
                      {row.classification.replace('_', ' ')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Export</h2>
        <p className="small muted" style={{ marginTop: 0 }}>
          Nothing here is written to Metrc. This app produces observations; the
          system of record applies adjustments, so exactly one system ever writes
          to compliance.
        </p>
        <div className="row wrap">
          <button onClick={() => void save(`discrepancies-${stamp}.csv`, discrepancyCsv(report), 'text/csv')}>
            Discrepancy CSV
          </button>
          <button onClick={() => void save(`count-events-${stamp}.csv`, countEventCsv(events), 'text/csv')}>
            Event log CSV
          </button>
          <button onClick={() => void save(`audit-report-${stamp}.txt`, reportSummary(report))}>
            Audit report
          </button>
        </div>
        {exportStatus && (
          <div className="small muted" style={{ marginTop: 10 }} role="status">
            {exportStatus}
          </div>
        )}
      </div>
    </>
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
