// @vitest-environment happy-dom
import * as React from 'react';
import { createPortal } from 'react-dom';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapTheme, useCreativePageTheme, useTheme } from './theme-store';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  });
  localStorage.setItem('holaday.theme', 'light');
  bootstrapTheme();
});
afterEach(() => {
  cleanup();
  localStorage.removeItem('holaday.theme');
  bootstrapTheme();
  vi.unstubAllGlobals();
});

describe('creative route theme', () => {
  it('themes body portals and native controls without persisting the override, then restores light', () => {
    function Page({ path }: { path: string }): JSX.Element {
      useCreativePageTheme(path);
      return createPortal(<div role="dialog">Portal</div>, document.body);
    }
    const page = render(<Page path="/video" />);
    expect(screen.getByRole('dialog').closest('.dark')).toBe(document.documentElement);
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(localStorage.getItem('holaday.theme')).toBe('light');
    page.rerender(<Page path="/image/" />);
    expect(screen.getByRole('dialog').closest('.dark')).toBe(document.documentElement);
    page.rerender(<Page path="/files" />);
    expect(screen.getByRole('dialog').closest('.dark')).toBeNull();
    expect(document.documentElement.classList.contains('holaday-creative-theme')).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('keeps portals dark during preference changes and restores the latest preference on exit', () => {
    const theme = renderHook(({ path }) => {
      useCreativePageTheme(path);
      return useTheme();
    }, { initialProps: { path: '/image' } });
    act(() => theme.result.current.setMode('dark'));
    act(() => theme.result.current.setMode('light'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    theme.rerender({ path: '/projects' });
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    act(() => theme.result.current.setMode('dark'));
    theme.rerender({ path: '/video' });
    theme.unmount();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('does not force the video editor dark and cleans up after StrictMode unmount', () => {
    const theme = renderHook(({ path }) => useCreativePageTheme(path), {
      initialProps: { path: '/video/edit/task-1' },
      wrapper: ({ children }) => <React.StrictMode>{children}</React.StrictMode>,
    });
    expect(theme.result.current).toBe(false);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    theme.rerender({ path: '/video' });
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    theme.unmount();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
