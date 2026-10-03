import type { GameUser, LaunchOverrides } from '@bsgames/dev-container-api';
import {
  dispatchDevContainerLayoutCommand as dispatch,
} from '@bsgames/dev-container-api/layout-commands';
import { listClientBindings } from '@bsgames/dev-container-api/client-controls';

export function getNextClientLabel(): string {
  return String(
    Math.max(0, ...listClientBindings().map((client) => Number(client.label))) + 1,
  ).padStart(2, '0');
}

export function createClientPanel(user: GameUser, title = user.name, values: LaunchOverrides = {}) {
  const clientId = 'client-' + crypto.randomUUID();
  return {
    id: clientId,
    component: 'client',
    tabComponent: 'client-tab',
    title,
    renderer: 'always' as const,
    params: {
      label: getNextClientLabel(),
      clientId,
      userId: user.id,
      values: { ...values },
      muted: true,
      sizeMode: 'adaptive',
      title,
    },
  };
}

export function addClient(user: GameUser, title: string, values: LaunchOverrides) {
  dispatch({
    type: 'addPanel',
    panel: { ...createClientPanel(user, title, values), position: { direction: 'right' } },
  });
}
