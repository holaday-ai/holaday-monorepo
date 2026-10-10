// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { CharacterAvatar } from './CharacterAvatar';
afterEach(cleanup);
it('prefers the uploaded photo, falls back to a character, then to a letter if both fail', () => {
 const {container} = render(<CharacterAvatar name="林" seed="user-1" src="https://example.test/photo.png"/>);
 const photo=container.querySelector('img')!;
 expect(photo.getAttribute('src')).toBe('https://example.test/photo.png');
 fireEvent.error(photo);
 expect(photo.getAttribute('src')).toMatch(/^\/holaday-ui\/avatars\//);
 fireEvent.error(photo);
 expect(container.querySelector('img')).toBeNull();
 expect(container.textContent).toBe('林');
});
