import process from 'node:process';
import { session } from 'electron';
import { randomUUID, createHash } from 'node:crypto';
import { writeJsonFile } from './json-file.js';
import { join } from 'node:path';
import {
  ClientViewHostMode,
  type ClientDescriptor,
  type GameConfig,
  type HostRuntime,
  type DevContainerPreference,
  type LaunchOverrides,
} from '@bsgames/dev-container-api/game-config';
import { SdkCommand, SdkEventKind, type SdkEvent } from '@bsgames/dev-container-api/sdk-protocol';
import type { DevContainerDebugInfo } from '@bsgames/dev-container-api';
import { UserStore } from './user-store.js';
import { createClientUrl } from './game-config.js';
interface Binding {
  descriptor: ClientDescriptor;
  loggedIn: boolean;
  send?: (event: SdkEvent) => void;
}
export class Runtime implements HostRuntime {
  static async open(
    config: GameConfig,
    preference: DevContainerPreference,
    debugInfo: DevContainerDebugInfo,
    stateDirectory: string,
  ): Promise<Runtime> {
    return new Runtime(
      config,
      preference,
      debugInfo,
      await UserStore.open(stateDirectory),
      stateDirectory,
    );
  }

  listUsers() {
    return this._users.list();
  }

  createUser(name: string) {
    return this._users.create(name);
  }

  renameUser(id: string, name: string) {
    return this._users.rename(id, name);
  }

  setPreviewUrlSource(source: () => Promise<string>): void {
    this._previewUrlSource = source;
  }

  async getPreviewUrl(): Promise<string> {
    if (!this._previewUrlSource) {
      throw new Error('The preview address source has not been activated.');
    }
    return this._previewUrlSource();
  }

  async previewClientUrl(values: LaunchOverrides): Promise<string> {
    return createClientUrl(this.config, values, await this.getPreviewUrl());
  }

  async registerClient(
    clientId: string,
    userId: string,
    values: LaunchOverrides,
  ): Promise<ClientDescriptor> {
    if (!clientId || typeof clientId !== 'string') {
      throw new Error('Client ID is required.');
    }
    const user = await this._users.get(userId);
    const existing = [...this._bindings.entries()].find(
      ([, binding]) => binding.descriptor.clientId === clientId,
    );
    if (existing) {
      throw new Error('Release the old client session before registering a new one.');
    }
    const token = randomUUID();
    const rawUrl = new URL(await this.previewClientUrl(values));
    rawUrl.searchParams.set('__devContainerClient', token);
    const url = rawUrl.href;
    const source = new URL(url);
    const identity = createHash('sha256')
      .update(JSON.stringify([this.config.game.id, user.id]))
      .digest('hex')
      .slice(0, 32);
    const frame = new URL('dev-container-client://' + identity + source.pathname + source.search);
    const partition
      = this.preference.viewHost === ClientViewHostMode.iframe
        ? 'persist:dev-container'
        : 'persist:client-' + identity;
    const descriptor: ClientDescriptor = {
      clientId,
      user,
      token,
      url: frame.href,
      frameUrl: frame.href,
      previewUrl: url,
      partition,
      sessionPath: session.fromPartition(partition).storagePath!,
      viewHost: this.preference.viewHost,
    };
    this._bindings.set(token, {
      descriptor,
      loggedIn: false,
    });
    await this.saveDebugSession();
    return descriptor;
  }

  findBinding(token: string): ClientDescriptor {
    const binding = this._bindings.get(token);
    if (!binding) {
      throw new Error('Unknown or expired client session.');
    }
    return binding.descriptor;
  }

  attachSender(token: string, send: (event: SdkEvent) => void): void {
    const binding = this._requireBinding(token);
    binding.send = send;
  }

  async request(token: string, command: SdkCommand): Promise<unknown> {
    const binding = this._requireBinding(token);
    switch (command) {
    case SdkCommand.login: {
      binding.loggedIn = true;
      return {
        user: { id: binding.descriptor.user.id },
      };
    }
    case SdkCommand.getUser:
      return binding.loggedIn ? { id: binding.descriptor.user.id } : undefined;
    case SdkCommand.logout:
      binding.loggedIn = false;
      return;
    default:
      throw new Error('Unsupported SDK command: ' + String(command));
    }
  }

  async releaseClient(token: string): Promise<void> {
    const binding = this._bindings.get(token);
    if (!binding) {
      return;
    }
    binding.send?.({
      kind: SdkEventKind.disconnected,
      message: 'Client session was released.',
    });
    this._bindings.delete(token);
    await this.saveDebugSession();
  }

  listDebugClients() {
    return [...this._bindings.values()].map((binding) => binding.descriptor);
  }

  saveDebugSession(): Promise<void> {
    const result = this._debugWrites.then(() =>
      writeJsonFile(join(this._stateDirectory, 'debug-session.json'), {
        version: 1,
        pid: process.pid,
        gameId: this.config.game.id,
        workspace: this._stateDirectory,
        remoteDebuggingPort: this._debugInfo.remoteDebuggingPort ?? null,
        devtoolsHttpOrigin: this._debugInfo.devtoolsHttpOrigin ?? null,
        viewHost: this.preference.viewHost,
        clients: this.listDebugClients(),
        updatedAt: new Date().toISOString(),
      }),
    );
    this._debugWrites = result.catch(() => {
    });
    return result;
  }

  private constructor(
    readonly config: GameConfig,
    readonly preference: DevContainerPreference,
    private readonly _debugInfo: DevContainerDebugInfo,
    private readonly _users: UserStore,
    private readonly _stateDirectory: string,
  ) {
  }

  private _previewUrlSource: (() => Promise<string>) | undefined;
  private _debugWrites: Promise<void> = Promise.resolve();
  private readonly _bindings = new Map<string, Binding>();

  private _requireBinding(token: string): Binding {
    const binding = this._bindings.get(token);
    if (!binding) {
      throw new Error('Unknown or expired client session.');
    }
    return binding;
  }
}
