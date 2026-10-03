import { vortexMainExtension } from '@bsgames/dev-container-extension-vortex/main';
import { accountMainExtension } from '@bsgames/dev-container-extension-account/main';
import {
  clientSimulatorMainExtension,
} from '@bsgames/dev-container-extension-client-simulator/main';
import { logsMainExtension } from '@bsgames/dev-container-extension-logs/main';
import { monitorMainExtension } from '@bsgames/dev-container-extension-monitor/main';
import { roomMainExtension } from '@bsgames/dev-container-extension-room/main';
import type { DevContainerMainExtension } from '@bsgames/dev-container-api';

export const devContainerMainExtensions: readonly DevContainerMainExtension[] = [
  vortexMainExtension,
  accountMainExtension,
  clientSimulatorMainExtension,
  logsMainExtension,
  monitorMainExtension,
  roomMainExtension,
];
