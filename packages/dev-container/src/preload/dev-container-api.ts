import type { DevContainerApi } from '../shared/ipc-contract.js';

export type { DevContainerApi };

declare global {
  interface Window {
    devContainer: DevContainerApi;
  }
}
