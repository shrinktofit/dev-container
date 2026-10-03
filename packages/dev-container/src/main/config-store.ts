import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { DevContainerLayoutState } from '../shared/ipc-contract.js';
import { writeJsonFile } from './json-file.js';
export interface DevContainerMainWindowState {
  version: 1;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  maximized: boolean;
}
interface SavedState {
  version: 1;
  layoutState?: DevContainerLayoutState;
  mainWindowState?: DevContainerMainWindowState;
}
export class ConfigStore {
  constructor(directory: string) {
    this._path = join(directory, 'window-layout.json');
  }

  get layoutState() {
    return this._state.layoutState;
  }

  get mainWindowState() {
    return this._state.mainWindowState;
  }

  async load(): Promise<void> {
    try {
      const saved = JSON.parse(await readFile(this._path, 'utf8'));
      if (saved.version !== 1) {
        throw new Error('Unsupported saved layout version.');
      }
      this._state = saved;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async setLayoutState(layoutState: DevContainerLayoutState): Promise<void> {
    this._state.layoutState = layoutState;
    await this._save();
  }

  async setMainWindowState(mainWindowState: DevContainerMainWindowState): Promise<void> {
    this._state.mainWindowState = mainWindowState;
    await this._save();
  }

  setMainWindowStateSync(mainWindowState: DevContainerMainWindowState): void {
    this._state.mainWindowState = mainWindowState;
    mkdirSync(dirname(this._path), {
      recursive: true,
    });
    writeFileSync(this._path, JSON.stringify(this._state, null, 2) + '\n', 'utf8');
  }

  async flush(): Promise<void> {
    await this._queue;
  }

  private _state: SavedState = {
    version: 1,
  };

  private _queue: Promise<unknown> = Promise.resolve();
  private readonly _path: string;
  private _save(): Promise<void> {
    const next = this._queue.then(() => writeJsonFile(this._path, this._state));
    this._queue = next.then(() => undefined, () => undefined);
    return next;
  }
}
