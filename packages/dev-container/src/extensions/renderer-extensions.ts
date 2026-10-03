import { accountRendererExtension } from '@bsgames/dev-container-extension-account/renderer';
import {
  clientSimulatorRendererExtension,
} from '@bsgames/dev-container-extension-client-simulator/renderer';
import { logsRendererExtension } from '@bsgames/dev-container-extension-logs/renderer';
import { monitorRendererExtension } from '@bsgames/dev-container-extension-monitor/renderer';
import { roomRendererExtension } from '@bsgames/dev-container-extension-room/renderer';
import type { DevContainerRendererExtension } from '@bsgames/dev-container-api';

export const devContainerRendererExtensions: readonly DevContainerRendererExtension[] = [
  accountRendererExtension,
  clientSimulatorRendererExtension,
  logsRendererExtension,
  monitorRendererExtension,
  roomRendererExtension,
];
