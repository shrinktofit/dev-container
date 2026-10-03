import { defineComponent, h, type PropType } from 'vue';
import type { GameUser } from './game-config.js';
export const UserBadge = defineComponent({
  props: { user: { type: Object as PropType<GameUser>, default: undefined } },
  setup(props) {
    return () =>
      h(
        'span',
        { 'class': 'user-badge', 'aria-hidden': true },
        (props.user?.name.trim().slice(0, 1) ?? '?').toUpperCase(),
      );
  },
});
