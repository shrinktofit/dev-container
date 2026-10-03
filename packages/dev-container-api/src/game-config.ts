export enum ClientViewHostMode {
  webview = 'webview',
  iframe = 'iframe',
}
export enum LaunchFieldType {
  string = 'string',
  number = 'number',
  integer = 'integer',
  boolean = 'boolean',
}
export enum HostLayoutSource {
  saved = 'saved',
  default = 'default',
  empty = 'empty',
}
export interface DevContainerPreference {
  version: 1;
  viewHost: ClientViewHostMode;
  layout: HostLayoutSource;
  saveLayout: boolean;
}
export type LaunchValue = string | number | boolean;
// null is serialized only for an explicit omission of an optional parameter.
export type LaunchOverrides = Record<string, LaunchValue | null>;
export interface LaunchFieldSchema {
  'type': LaunchFieldType;
  'title'?: string;
  'description'?: string;
  'enum'?: LaunchValue[];
  'default'?: LaunchValue;
  'x-default-env'?: string;
  'minimum'?: number;
  'maximum'?: number;
  'minLength'?: number;
  'maxLength'?: number;
}
export interface LaunchSchema {
  $schema?: string;
  type: 'object';
  properties: Record<string, LaunchFieldSchema>;
  required?: string[];
  additionalProperties: false;
}
export interface GameConfig {
  version: 1;
  game: { id: string; title: string };
  client: { dir: string; subpath: string };
  launch: { schema: LaunchSchema };
}
export interface GameUser {
  readonly id: string;
  readonly name: string;
}
export interface ClientDescriptor {
  clientId: string;
  user: GameUser;
  token: string;
  url: string;
  frameUrl: string;
  previewUrl: string;
  partition: string;
  sessionPath: string;
  viewHost: ClientViewHostMode;
}
export interface HostRuntime {
  readonly config: GameConfig;
  readonly preference: DevContainerPreference;
  listUsers(): Promise<GameUser[]>;
  createUser(name: string): Promise<GameUser>;
  renameUser(id: string, name: string): Promise<GameUser>;
  setPreviewUrlSource(source: () => Promise<string>): void;
  getPreviewUrl(): Promise<string>;
  previewClientUrl(values: LaunchOverrides): Promise<string>;
  registerClient(
    clientId: string,
    userId: string,
    values: LaunchOverrides,
  ): Promise<ClientDescriptor>;
  releaseClient(token: string): Promise<void>;
  listDebugClients(): unknown[];
}
export function createLaunchDefaults(schema: LaunchSchema): Record<string, LaunchValue> {
  const values: Record<string, LaunchValue> = {};
  for (const [key, field] of Object.entries(schema.properties)) {
    if (field.default !== undefined) {
      values[key] = field.default;
    }
  }
  return values;
}

export function createLaunchValues(
  schema: LaunchSchema,
  overrides: LaunchOverrides,
): Record<string, LaunchValue> {
  const values = createLaunchDefaults(schema);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) {
      delete values[key];
    } else {
      Object.defineProperty(values, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return values;
}
