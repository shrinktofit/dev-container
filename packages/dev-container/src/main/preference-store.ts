import { readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { Ajv } from 'ajv';
import {
  ClientViewHostMode,
  HostLayoutSource,
  type DevContainerPreference,
} from '@bsgames/dev-container-api';
import { writeJsonFile } from './json-file.js';
const ajv = new Ajv({ allErrors: true, strict: true });
const validate = ajv.compile({
  type: 'object',
  required: [
    'version',
    'viewHost',
    'layout',
    'saveLayout',
  ],
  additionalProperties: false,
  properties: {
    version: { const: 1 },
    viewHost: { enum: Object.values(ClientViewHostMode) },
    layout: { enum: Object.values(HostLayoutSource) },
    saveLayout: { type: 'boolean' },
  },
});
export class PreferenceStore {
  static async open(directory: string): Promise<PreferenceStore> {
    const file = join(directory, 'preference.json');
    const defaults: DevContainerPreference = {
      version: 1,
      viewHost: ClientViewHostMode.webview,
      layout: HostLayoutSource.saved,
      saveLayout: true,
    };
    let sourceFile = file;
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(file + ': ' + String(error), { cause: error });
      }
      sourceFile = join(directory, 'settings.json');
      try {
        text = await readFile(sourceFile, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return new PreferenceStore(file, defaults);
        }
        throw new Error(sourceFile + ': ' + String(error), { cause: error });
      }
    }
    try {
      const value: unknown = JSON.parse(text);
      if (!validate(value)) {
        throw new Error(ajv.errorsText(validate.errors));
      }
      // Preserve the previous state file when adopting the preference name.
      if (sourceFile !== file) {
        await rename(sourceFile, file);
      }
      return new PreferenceStore(file, value);
    } catch (error) {
      throw new Error(sourceFile + ': ' + String(error), { cause: error });
    }
  }

  get preference(): DevContainerPreference {
    return { ...this._preference };
  }

  async save(value: unknown): Promise<void> {
    if (!validate(value)) {
      throw new Error(this._file + ': ' + ajv.errorsText(validate.errors));
    }
    await writeJsonFile(this._file, value);
    this._preference = { ...value };
  }

  private constructor(
    private readonly _file: string,
    private _preference: DevContainerPreference,
  ) {
  }
}
