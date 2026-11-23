import { parsePortalInput } from './portal-input.js';

describe('parsePortalInput (v1: portalInputSchema)', () => {
  it.each([
    [
      { type: 'click', x: 10, y: 20 },
      { type: 'click', x: 10, y: 20 },
    ],
    [
      { type: 'scroll', deltaY: -120 },
      { type: 'scroll', deltaY: -120 },
    ],
    [
      { type: 'key', key: 'Enter' },
      { type: 'key', key: 'Enter' },
    ],
    [
      { type: 'text', text: 'student@liu.edu.lb' },
      { type: 'text', text: 'student@liu.edu.lb' },
    ],
    [{ type: 'back' }, { type: 'back' }],
    [{ type: 'reload' }, { type: 'reload' }],
    [
      { type: 'resize', width: 1024, height: 700 },
      { type: 'resize', width: 1024, height: 700 },
    ],
  ])('accepts %o', (raw, expected) => {
    expect(parsePortalInput(raw)).toEqual(expected);
  });

  it('clamps a huge scroll to ±3000', () => {
    expect(parsePortalInput({ type: 'scroll', deltaY: 99999 })).toEqual({
      type: 'scroll',
      deltaY: 3000,
    });
    expect(parsePortalInput({ type: 'scroll', deltaY: -99999 })).toEqual({
      type: 'scroll',
      deltaY: -3000,
    });
  });

  it('clamps and rounds a resize into 320–1920 × 240–1200', () => {
    expect(
      parsePortalInput({ type: 'resize', width: 99999, height: 10.6 }),
    ).toEqual({
      type: 'resize',
      width: 1920,
      height: 240,
    });
  });

  it('drops fields that are not part of the message', () => {
    expect(
      parsePortalInput({ type: 'back', url: 'http://169.254.169.254/' }),
    ).toEqual({ type: 'back' });
  });

  it.each([
    ['not an object', 'click'],
    ['null', null],
    ['an unknown type', { type: 'navigate', url: 'http://10.0.0.1/' }],
    ['a click outside 0–4000', { type: 'click', x: 5000, y: 1 }],
    ['a negative click', { type: 'click', x: -1, y: 1 }],
    ['a click with text coordinates', { type: 'click', x: '1', y: '2' }],
    ['an infinite scroll', { type: 'scroll', deltaY: Infinity }],
    ['a key outside the list', { type: 'key', key: 'F12' }],
    ['a modifier chord', { type: 'key', key: 'Control+L' }],
    ['empty text', { type: 'text', text: '' }],
    ['text over 500 characters', { type: 'text', text: 'x'.repeat(501) }],
    ['a resize without height', { type: 'resize', width: 800 }],
  ])('rejects %s', (_case, raw) => {
    expect(parsePortalInput(raw)).toBeNull();
  });
});
