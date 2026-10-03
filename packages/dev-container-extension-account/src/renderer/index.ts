import type { DevContainerRendererExtension } from '@bsgames/dev-container-api';
import {
  dispatchDevContainerLayoutCommand as dispatch,
} from '@bsgames/dev-container-api/layout-commands';
import AccountPanel from './account-panel.vue';
export const accountRendererExtension: DevContainerRendererExtension = {
  id: 'account',
  panels: {
    account: AccountPanel,
  },
  menuActions: [
    {
      id: 'account',
      label: '用户管理',
      order: 20,
      run() {
        dispatch({
          type: 'addPanel',
          panel: {
            id: 'account',
            component: 'account',
            title: '用户管理',
          },
        });
      },
    },
  ],
};
