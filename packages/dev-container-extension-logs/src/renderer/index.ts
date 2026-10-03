import { createBlankPanel, type DevContainerRendererExtension } from '@bsgames/dev-container-api';

const BlankPanel = createBlankPanel();

export const logsRendererExtension = {
  id: 'logs',
  panels: {
    logs: BlankPanel,
  },
} satisfies DevContainerRendererExtension;
