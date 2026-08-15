/**
 * File delivery.
 *
 * The export *is* the v1 deliverable — this app deliberately writes nothing to
 * Metrc, so a discrepancy file that never reaches the operator means the audit
 * produced nothing. Two transports are needed because an anchor-with-blob-href,
 * which works in any ordinary browser, is inert inside a sandboxed viewer that
 * withholds download permission. A dead button there would fail silently, which
 * is the one outcome this file exists to prevent.
 */

export type DownloadOutcome = 'saved' | 'declined' | 'unavailable';

/** The claude.ai viewer runtime, present only when the page runs as an Artifact. */
interface ClaudeRuntime {
  use(name: 'downloads'): Promise<{
    save(request: { filename: string; data: string | Blob }): Promise<{ status: 'saved' }>;
  } | null>;
}

function runtime(): ClaudeRuntime | null {
  return (globalThis as { claude?: ClaudeRuntime }).claude ?? null;
}

function errorCode(cause: unknown): string {
  return typeof cause === 'object' && cause !== null && 'code' in cause
    ? String((cause as { code: unknown }).code)
    : 'unavailable';
}

export async function download(
  filename: string,
  contents: string,
  mime = 'text/plain',
): Promise<DownloadOutcome> {
  const claude = runtime();

  if (claude) {
    const downloads = await claude.use('downloads').catch(() => null);
    if (!downloads) return 'unavailable';

    try {
      await downloads.save({ filename, data: contents });
      return 'saved';
    } catch (cause) {
      const code = errorCode(cause);

      // The viewer said no. Never auto-retry — that would nag.
      if (code === 'declined' || code === 'rate_limited') return 'declined';

      // Some viewers allow only a base set of extensions, which excludes csv.
      // The contents are plain text either way, so re-offer as .txt rather
      // than losing the file over its suffix.
      if (code === 'extension_not_enabled' || code === 'rejected_extension') {
        try {
          await downloads.save({ filename: `${filename}.txt`, data: contents });
          return 'saved';
        } catch (retryCause) {
          return errorCode(retryCause) === 'declined' ? 'declined' : 'unavailable';
        }
      }

      return 'unavailable';
    }
  }

  const url = URL.createObjectURL(new Blob([contents], { type: `${mime};charset=utf-8` }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
  return 'saved';
}
