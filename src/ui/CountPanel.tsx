import { useEffect, useRef, useState } from 'react';
import type { ExpectedInventory, CountMethod, UnitOfMeasure } from '../domain/types';
import type { CountSource, ObserverHandle, StreamingCountSource } from '../count/CountSource';
import { isStreaming } from '../count/CountSource';
import { CameraCountSource } from '../count/camera';
import { ScaleCountSource, WebBluetoothScale } from '../count/scale';
import { manualSource } from '../count/manual';

/**
 * The confidence floor for pre-filling a count. Set conservatively on purpose:
 * an automated count that is wrong *and* trusted is the one outcome strictly
 * worse than counting by hand.
 */
export const AUTOFILL_CONFIDENCE = 0.7;

interface Props {
  pkg: ExpectedInventory;
  shadow: boolean;
  onCommit: (input: {
    quantity: number;
    unitOfMeasure: UnitOfMeasure;
    method: CountMethod;
    confidence: number | null;
    modelVersion: string | null;
  }) => void;
  onCancel: () => void;
}

export function CountPanel({ pkg, shadow, onCommit, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const handleRef = useRef<ObserverHandle | null>(null);
  const [method, setMethod] = useState<CountMethod>('manual');
  const [available, setAvailable] = useState<CountMethod[]>(['manual']);
  const [quantity, setQuantity] = useState<string>('');
  const [confidence, setConfidence] = useState<number | null>(null);
  const [settled, setSettled] = useState(false);
  const [modelVersion, setModelVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tare, setTare] = useState('0');

  // Which sources can serve *this* package. The routing is per-package, not
  // global: the scale declines anything with no known unit weight, the camera
  // declines gram-denominated packages, and manual always accepts.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const candidates: [CountMethod, CountSource][] = [
        ['camera', new CameraCountSource(document.createElement('video'))],
        ['scale', new ScaleCountSource(new WebBluetoothScale())],
        ['manual', manualSource],
      ];
      const usable: CountMethod[] = [];
      for (const [name, source] of candidates) {
        if (source.supports(pkg) && (await source.isAvailable())) usable.push(name);
      }
      if (!cancelled) setAvailable(usable);
    })();
    return () => {
      cancelled = true;
    };
  }, [pkg]);

  // Tear down camera/Bluetooth whenever the modality or package changes.
  useEffect(() => {
    return () => {
      handleRef.current?.stop();
      handleRef.current = null;
    };
  }, [method, pkg.id]);

  const start = async (next: CountMethod): Promise<void> => {
    handleRef.current?.stop();
    handleRef.current = null;
    setMethod(next);
    setConfidence(null);
    setSettled(false);
    setError(null);

    if (next === 'manual') {
      setQuantity('');
      return;
    }

    try {
      const source: StreamingCountSource =
        next === 'camera'
          ? new CameraCountSource(videoRef.current!)
          : new ScaleCountSource(new WebBluetoothScale(), {
              tareG: Number(tare) || 0,
              integerTolerance: 0.15,
            });

      if (!isStreaming(source)) return;

      handleRef.current = await source.observe(pkg, (result) => {
        // In shadow mode the automated answer is recorded but never shown, so
        // the operator's own count stays uninfluenced by the machine.
        if (!shadow) {
          setQuantity(String(result.quantity));
          setConfidence(result.confidence);
          setSettled(result.settled);
        }
        setModelVersion(result.modelVersion ?? null);
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setMethod('manual');
    }
  };

  const parsed = Number(quantity);
  const valid = quantity.trim() !== '' && Number.isFinite(parsed) && parsed >= 0;
  const autofilled = method !== 'manual' && confidence !== null && confidence >= AUTOFILL_CONFIDENCE;

  const commit = (): void => {
    if (!valid) return;
    handleRef.current?.stop();
    onCommit({
      quantity: parsed,
      unitOfMeasure: pkg.unitOfMeasure,
      method,
      confidence: method === 'manual' ? null : confidence,
      modelVersion: method === 'manual' ? null : modelVersion,
    });
  };

  return (
    <div className="card">
      <div className="row spread" style={{ marginBottom: 12 }}>
        <div className="grow">
          <div style={{ fontWeight: 600 }}>{pkg.itemName}</div>
          <div className="mono muted truncate">{pkg.packageLabel}</div>
        </div>
        <button className="ghost" onClick={onCancel}>Close</button>
      </div>

      {shadow && (
        <div className="banner">
          <strong>Shadow mode.</strong> Count as you normally would. The automated
          reading is recorded for accuracy scoring and is not shown to you.
        </div>
      )}
      {error && <div className="banner bad">{error}</div>}

      <div className="row wrap" style={{ marginBottom: 12 }}>
        {(['camera', 'scale', 'manual'] as const).map((name) => (
          <button
            key={name}
            className={method === name ? 'primary' : ''}
            disabled={!available.includes(name)}
            onClick={() => void start(name)}
          >
            {LABELS[name]}
          </button>
        ))}
      </div>

      {method === 'scale' && (
        <div className="row" style={{ marginBottom: 12 }}>
          <label className="small muted" style={{ minWidth: 96 }}>Container tare</label>
          <input
            className="grow"
            inputMode="decimal"
            value={tare}
            onChange={(e) => setTare(e.target.value)}
            placeholder="grams"
          />
        </div>
      )}

      <video ref={videoRef} playsInline muted hidden={method !== 'camera' || shadow} />

      <div className="stack" style={{ marginTop: 12 }}>
        {method === 'manual' || shadow ? (
          <input
            autoFocus
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder={`Count in ${pkg.unitOfMeasure.toLowerCase()}`}
          />
        ) : (
          <div className="readout">
            <div className="value">{quantity === '' ? '—' : quantity}</div>
            <div className="unit">
              {pkg.unitOfMeasure} · expected {pkg.quantity}
            </div>
            <div className={`meter ${settled ? 'ok' : 'warn'}`}>
              <span style={{ width: `${Math.round((confidence ?? 0) * 100)}%` }} />
            </div>
            <div className="small muted" style={{ marginTop: 8 }}>
              {confidence === null
                ? 'Waiting for a reading…'
                : autofilled
                  ? `Confident (${(confidence * 100).toFixed(0)}%) — confirm or correct`
                  : `Low confidence (${(confidence * 100).toFixed(0)}%) — verify by hand`}
            </div>
          </div>
        )}

        <div className="row">
          <button className="grow" onClick={() => setMethod('manual')} disabled={method === 'manual'}>
            Enter by hand
          </button>
          <button className="primary grow" disabled={!valid} onClick={commit}>
            {autofilled ? 'Confirm count' : 'Record count'}
          </button>
        </div>
      </div>
    </div>
  );
}

const LABELS: Record<'camera' | 'scale' | 'manual', string> = {
  camera: 'Camera',
  scale: 'Scale',
  manual: 'Manual',
};
