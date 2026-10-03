import type { DevContainerUser } from './sdk-runtime.js';
export const sdkIpcChannel = 'dev-container:sdk';
export const guestPreparationIpcChannel = 'dev-container:sdk:prepare-guest';
export const sdkEventChannel = 'dev-container:sdk:event';
export enum SdkCommand {
  login = 'login',
  getUser = 'get-user',
  logout = 'logout',
}
export enum SdkEventKind {
  disconnected = 'disconnected',
}
export interface SdkEvent {
  readonly kind: SdkEventKind.disconnected;
  readonly message: string;
}
export interface LoginResult {
  readonly user: DevContainerUser;
}
