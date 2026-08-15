import type { CountSource } from './CountSource';
import type { ExpectedInventory } from '../domain/types';

/**
 * The guaranteed fallback. It accepts every package unconditionally and is
 * always one tap away, because an operator who cannot override the machine will
 * eventually stop using the machine — and because a licensed human remains
 * accountable for the count regardless of what produced the number.
 */
export const manualSource: CountSource = {
  method: 'manual',
  label: 'Manual entry',
  async isAvailable() {
    return true;
  },
  supports(_pkg: ExpectedInventory) {
    return true;
  },
};
