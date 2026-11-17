import { expect, it } from 'vitest';
import { encodeAttribute, latexImageNames } from '../src/render.js';

it('names LaTeX images like Anki when the source contains non-breaking spaces', () => {
  // Anki turns &nbsp; / U+00A0 into a plain space before hashing the LaTeX source.
  const plain = latexImageNames('[$] cos(t)[/$]', false);
  expect(latexImageNames('[$]&nbsp;cos(t)[/$]', false)).toEqual(plain);
  expect(latexImageNames('[$] cos(t)[/$]', false)).toEqual(plain);
});

it('encodes Latin-1 characters in attributes numerically, like Anki', () => {
  expect(encodeAttribute('liés 日本')).toBe('li&#xE9;s&#x20;日本');
});
