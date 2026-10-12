<script lang="ts">
  import type { Avatar } from '../../net/protocol';
  import { initials, seatColor } from '../seatColors';

  interface Props {
    avatar?: Avatar;
    name: string;
    /** Fallback colour when there's no avatar. */
    seat?: number;
    size?: number;
  }
  let { avatar, name, seat = 0, size = 34 }: Props = $props();
</script>

<span
  class="av"
  style:--c={avatar?.color ?? seatColor(seat)}
  style:width="{size}px"
  style:height="{size}px"
  style:font-size="{avatar ? size * 0.56 : size * 0.36}px"
  aria-hidden="true"
>
  {avatar?.emoji ?? initials(name)}
</span>

<style>
  .av {
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 50%;
    font-weight: 700;
    line-height: 1;
    color: #10231c;
    background: var(--c);
    background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--c) 55%, white), var(--c));
    box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.15);
  }
</style>
