import { createBlankPanel, type DevContainerRendererExtension } from '@bsgames/dev-container-api';

const BlankPanel = createBlankPanel();

export const roomRendererExtension = {
  id: 'room',
  panels: {
    room: BlankPanel,
  },
} satisfies DevContainerRendererExtension;
