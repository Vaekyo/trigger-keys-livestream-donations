import { describe, expect, it } from 'vitest';
import { hexToHsv, hexToRgb, hsvToHex, linePixels, mixHex, normalizeHex, rgbToHex, shiftPixels, tintPixels } from '../src/render/color';

describe('color math', () => {
  it('converts hex ↔ rgb', () => {
    expect(hexToRgb('#ff8000')).toEqual([255, 128, 0]);
    expect(hexToRgb('#abc')).toEqual([170, 187, 204]);
    expect(rgbToHex(255, 128, 0)).toBe('#ff8000');
    expect(normalizeHex('ABC')).toBe('#aabbcc');
  });

  it('round-trips through HSV', () => {
    for (const hex of ['#ff7eb6', '#8c7bff', '#2b2140', '#ffffff', '#000000', '#5bd6a0']) {
      const [h, s, v] = hexToHsv(hex);
      expect(hsvToHex(h, s, v)).toBe(hex);
    }
  });

  it('mixes colors', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('smart tint multiplies: white → color, gray → shaded color, alpha kept', () => {
    const px = new Uint8ClampedArray([255, 255, 255, 200, 128, 128, 128, 255]);
    tintPixels(px, [200, 100, 50]);
    expect([...px.slice(0, 4)]).toEqual([200, 100, 50, 200]);
    expect([...px.slice(4, 7)]).toEqual([100, 50, 25]);
  });

  it('line recolor: black → color, white stays white', () => {
    const px = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
    linePixels(px, [90, 40, 20]);
    expect([...px.slice(0, 3)]).toEqual([90, 40, 20]);
    expect([...px.slice(4, 7)]).toEqual([255, 255, 255]);
  });

  it('a zero HSB shift leaves pixels unchanged', () => {
    const px = new Uint8ClampedArray([12, 200, 99, 255]);
    shiftPixels(px, 0, 0, 0);
    expect([...px]).toEqual([12, 200, 99, 255]);
  });

  it('a 120° hue shift turns red into green', () => {
    const px = new Uint8ClampedArray([255, 0, 0, 255]);
    shiftPixels(px, 120, 0, 0);
    expect([...px.slice(0, 3)]).toEqual([0, 255, 0]);
  });
});
