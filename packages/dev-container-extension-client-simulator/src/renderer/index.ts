import type { DevContainerRendererExtension, GameUser } from '@bsgames/dev-container-api';
import { invokeDevContainerExtension as invoke } from '@bsgames/dev-container-api';
import ClientTab from './client-tab.vue';
import ClientPanel from './client-panel.vue';
import { createClientPanel } from './create-client.ts';
export { addClient } from './create-client.ts';
export { default as AddClientDialog } from './add-client-dialog.vue';

export const clientSimulatorRendererExtension: DevContainerRendererExtension = {
  id: 'client-simulator',
  panels: { client: ClientPanel },
  tabComponents: { 'client-tab': ClientTab },
  async afterLayoutReady(ctx) {
    if (ctx.layoutSource === 'empty' || ctx.restoredLayout || ctx.layout.hasPanels()) {
      return;
    }
    const users = await invoke<GameUser[]>('account', 'list');
    ctx.layout.addPanel(createClientPanel(users[0]));
  },
};
