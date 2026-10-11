export const SEAT_COLORS = ['#e9c46a', '#5fb3d9', '#e76f51', '#9b8cf2', '#7bd389', '#f28cbf', '#f4a261', '#4fd1c5', '#c9d36a', '#d98ae0'];
export const seatColor = (seat: number) => SEAT_COLORS[seat % SEAT_COLORS.length];
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';
