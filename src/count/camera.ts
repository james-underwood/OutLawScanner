import type { CountResult, ObserverHandle, StreamingCountSource } from './CountSource';
import type { ExpectedInventory } from '../domain/types';
import { countFrame } from './vision/count';
import { ConsensusBuffer, DEFAULT_CONSENSUS, type ConsensusOptions } from './consensus';

export interface CameraOptions {
  /**
   * Inference frames per second. Deliberately low: a six-hour audit outlives a
   * phone battery running detection at display rate, and consensus across five
   * frames at 5fps still settles in a second.
   */
  fps: number;
  /** Frames are downscaled before segmentation; accuracy is flat above this. */
  processWidth: number;
  consensus: ConsensusOptions;
}

export const DEFAULT_CAMERA_OPTIONS: CameraOptions = {
  fps: 5,
  processWidth: 480,
  consensus: DEFAULT_CONSENSUS,
};

export const MODEL_VERSION = 'cc-adaptive/1';

export class CameraCountSource implements StreamingCountSource {
  readonly method = 'camera' as const;
  readonly label = 'Camera';

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly options: CameraOptions = DEFAULT_CAMERA_OPTIONS,
  ) {}

  async isAvailable(): Promise<boolean> {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }

  /**
   * Piece counts only. A camera cannot weigh bulk flower, and pretending
   * otherwise would produce a confident number in the wrong unit.
   */
  supports(pkg: ExpectedInventory): boolean {
    return pkg.unitOfMeasure === 'Each';
  }

  async observe(
    pkg: ExpectedInventory,
    onUpdate: (result: CountResult & { settled: boolean }) => void,
  ): Promise<ObserverHandle> {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    this.video.srcObject = stream;
    await this.video.play();

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const consensus = new ConsensusBuffer(this.options.consensus);
    let stopped = false;

    const tick = (): void => {
      if (stopped) return;

      const { videoWidth, videoHeight } = this.video;
      if (videoWidth > 0) {
        const scale = Math.min(1, this.options.processWidth / videoWidth);
        canvas.width = Math.round(videoWidth * scale);
        canvas.height = Math.round(videoHeight * scale);
        ctx.drawImage(this.video, 0, 0, canvas.width, canvas.height);

        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        // The footprint prior is stored in reference-capture pixels; rescale it
        // to this frame's working resolution or every blob fails the size test.
        const prior =
          pkg.unitFootprintPx === null ? null : pkg.unitFootprintPx * scale * scale;

        const frame = countFrame(image.data, canvas.width, canvas.height, prior);
        const settled = consensus.push(frame.quantity, frame.confidence);

        onUpdate({
          quantity: settled?.quantity ?? frame.quantity,
          unitOfMeasure: 'Each',
          confidence: settled?.confidence ?? frame.confidence,
          settled: settled !== null,
          modelVersion: MODEL_VERSION,
        });
      }

      timer = self.setTimeout(tick, 1000 / this.options.fps);
    };

    let timer = self.setTimeout(tick, 0);

    return {
      stop: () => {
        stopped = true;
        clearTimeout(timer);
        for (const track of stream.getTracks()) track.stop();
        this.video.srcObject = null;
      },
    };
  }
}
