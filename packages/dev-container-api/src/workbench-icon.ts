import { defineComponent, h } from 'vue';

const paths: Record<string, string[]> = {
  clients: [
    'M3 4h18v12H3z',
    'M8 21h8M12 16v5',
    'm10 7 5 3-5 3z',
  ],
  users: [
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
    'M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  ],
  settings: ['M3 6h6m4 0h8M3 18h10m4 0h4', 'M9 3h4v6H9zM13 15h4v6h-4z'],
  refresh: [
    'M20 7v5h-5',
    'M4 17v-5h5',
    'M6 7a7 7 0 0 1 12-2l2 2M4 17l2 2a7 7 0 0 0 12-2',
  ],
  muted: ['M11 5 6 9H3v6h3l5 4Z', 'm17 9 6 6m0-6-6 6'],
  sound: ['M11 5 6 9H3v6h3l5 4Z', 'M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14'],
  viewport: ['M3 8V3h5m8 0h5v5M3 16v5h5m8 0h5v-5', 'M8 8h8v8H8z'],
  code: ['m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16'],
  close: ['m6 6 12 12M18 6 6 18'],
  plus: ['M12 5v14M5 12h14'],
  search: ['M19 19 15 15', 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14'],
  copy: ['M8 8h13v13H8zM16 8V3H3v13h5'],
  edit: ['m15 5 4 4M4 16 16 4a2.8 2.8 0 0 1 4 4L8 20l-5 1Z'],
  trash: ['M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7'],
  undo: ['M3 10V4m0 6h6', 'M3 10a8 8 0 1 1 1 8'],
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z', 'M15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0'],
  eyeOff: [
    'm3 3 18 18',
    (
      'M10.6 5.1A12 12 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-3.2 '
      + '4.2M6.3 6.3A18 18 0 0 0 2 12s3.5 7 10 7a13 13 0 0 0 5.7-1.3'
    ),
    'M9.9 9.9a3 3 0 0 0 4.2 4.2',
  ],
  chevron: ['m6 9 6 6 6-6'],
};

export const DevContainerIcon = defineComponent({
  props: { name: { type: String, required: true } },
  setup(props) {
    return () =>
      h(
        'svg',
        {
          'class': 'dc-icon',
          'viewBox': '0 0 24 24',
          'aria-hidden': true,
        },
        paths[props.name].map((d) => h('path', { d })),
      );
  },
});
