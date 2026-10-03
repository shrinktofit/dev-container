import './global.css';
import 'vuetify/styles';
import 'dockview-vue/dist/styles/dockview.css';

import { createApp } from 'vue';
import { createVuetify } from 'vuetify';
import * as vuetifyComponents from 'vuetify/components';
import App from './app.vue';
import { devContainerRendererExtensions } from '../extensions/renderer-extensions.js';

const app = createApp(App);

for (const extension of devContainerRendererExtensions) {
  for (const [panelName, panelComponent] of Object.entries(extension.panels)) {
    app.component(panelName, panelComponent);
  }
  for (const [tabComponentName, tabComponent] of Object.entries(extension.tabComponents ?? {})) {
    app.component(tabComponentName, tabComponent);
  }
}

app.use(createVuetify({
  components: vuetifyComponents,
  theme: {
    defaultTheme: 'devContainerDark',
    themes: {
      devContainerDark: {
        dark: true,
        colors: {
          'background': '#080f19',
          'surface': '#101d2c',
          'on-background': '#c4e0f4',
          'on-surface': '#c4e0f4',
          'primary': '#a4ddff',
          'secondary': '#87afce',
          'error': '#dc2626',
          'info': '#0284c7',
          'success': '#16a34a',
          'warning': '#d97706',
        },
      },
    },
  },
}));

app.mount('#app');
