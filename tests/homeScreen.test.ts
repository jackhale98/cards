import { describe, expect, it } from 'vitest';
import { canAddToHomeScreen, type Device } from '../src/ui/homeScreen';

const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const CHROME_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1';
const INSTAGRAM_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';

const device = (userAgent: string, o: Partial<Device> = {}): Device => ({ userAgent, maxTouchPoints: 5, matches: () => false, ...o });

describe('add to Home Screen', () => {
  it('is suggested in Safari (and other iPhone browsers) on an iPhone or iPad', () => {
    expect(canAddToHomeScreen(device(SAFARI_IPHONE))).toBe(true);
    expect(canAddToHomeScreen(device(CHROME_IPHONE))).toBe(true);
    expect(canAddToHomeScreen(device(IPAD))).toBe(true);
  });

  it('is not suggested once opened from the Home Screen', () => {
    expect(canAddToHomeScreen(device(SAFARI_IPHONE, { standalone: true }))).toBe(false);
    expect(canAddToHomeScreen(device(SAFARI_IPHONE, { matches: (q) => q.includes('fullscreen') }))).toBe(false);
    expect(canAddToHomeScreen(device(SAFARI_IPHONE, { matches: (q) => q.includes('standalone') }))).toBe(false);
  });

  it('is not suggested in an app’s own browser, on a Mac, or on Android', () => {
    expect(canAddToHomeScreen(device(INSTAGRAM_IPHONE))).toBe(false);
    expect(canAddToHomeScreen(device(IPAD, { maxTouchPoints: 0 }))).toBe(false); // a Mac: no touch screen
    expect(canAddToHomeScreen(device(ANDROID))).toBe(false);
  });
});
