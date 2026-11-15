// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { CharacterAvatar } from './CharacterAvatar';
afterEach(cleanup);
it('prefers the uploaded photo, falls back to a character, then to a letter if both fail', () => {
  const { container } = render(
    <CharacterAvatar
      name="林"
      seed="user-1"
      src="https://lh3.googleusercontent.com/a/ACg8ocJxYz1234567890abc=s96-c"
    />,
  );
  const photo = container.querySelector('img')!;
  // G7 / Q-8: a Google photo comes through HOLA DAY's own proxy.
  expect(photo.getAttribute('src')).toBe(
    `/api/avatar?url=${encodeURIComponent('https://lh3.googleusercontent.com/a/ACg8ocJxYz1234567890abc=s96-c')}`,
  );
  fireEvent.error(photo);
  expect(photo.getAttribute('src')).toMatch(/^\/holaday-ui\/avatars\//);
  fireEvent.error(photo);
  expect(container.querySelector('img')).toBeNull();
  expect(container.textContent).toBe('林');
});

it('G7 / Q-8: another site’s photo address is never loaded — the character shows instead', () => {
  const { container } = render(
    <CharacterAvatar name="林" seed="user-1" src="https://example.test/photo.png" />,
  );
  expect(container.querySelector('img')!.getAttribute('src')).toMatch(/^\/holaday-ui\/avatars\//);
});
