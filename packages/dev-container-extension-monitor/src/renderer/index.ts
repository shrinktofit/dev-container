import { createBlankPanel, type DevContainerRendererExtension } from '@bsgames/dev-container-api';
import { dispatchDevContainerLayoutCommand } from '@bsgames/dev-container-api/layout-commands';

const BlankPanel = createBlankPanel();
const monitorPanelComponentName = 'monitor';

let monitorPanelSequence = 0;

export const monitorRendererExtension = {
  id: 'monitor',
  panels: {
    [monitorPanelComponentName]: BlankPanel,
  },
  menuActions: [
    {
      id: 'open-server-monitor',
      label: '打开监视面板',
      group: {
        id: 'server',
        label: '服务端',
        order: 20,
      },
      order: 10,
      run() {
        openServerMonitorPanel();
      },
    },
  ],
} satisfies DevContainerRendererExtension;

function openServerMonitorPanel(): void {
  monitorPanelSequence++;
  dispatchDevContainerLayoutCommand({
    type: 'addPanel',
    panel: {
      id: `server-monitor-${Date.now()}-${monitorPanelSequence}`,
      component: monitorPanelComponentName,
      title: 'Server Monitor',
      params: {
        title: 'Server Monitor',
      },
      position: {
        direction: 'right',
      },
    },
  });
}
