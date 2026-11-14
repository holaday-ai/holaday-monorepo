// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { BrowserHomeGate } from './App';

afterEach(() => cleanup());

const compact = (text: string) => text.replace(/\s+/g, '');

describe('BROWSER-HOME-1 /browser route gate', () => {
  const at = (enabled: boolean | null) =>
    render(
      <MemoryRouter initialEntries={['/browser']}>
        <Routes>
          <Route path="/" element={<p>home</p>} />
          <Route
            path="/browser"
            element={
              <BrowserHomeGate enabled={enabled}>
                <p>cloud browser</p>
              </BrowserHomeGate>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

  it('redirects to / when the flag is off, without loading the page', () => {
    const off = at(false);
    expect(off.getByText('home')).toBeTruthy();
    expect(off.queryByText('cloud browser')).toBeNull();
  });

  it('waits for auth.me instead of redirecting early, and renders when on', () => {
    const loading = at(null);
    expect(loading.queryByText('home')).toBeNull();
    expect(loading.queryByText('cloud browser')).toBeNull();
    cleanup();
    expect(at(true).getByText('cloud browser')).toBeTruthy();
  });

  it('is mounted under the authed AppShell and reads me.browserHomeEnabled', () => {
    const app = compact(readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8'));
    expect(app).toContain('<Routepath="/browser"element={<BrowserHomeRoute/>}/>');
    expect(app).toContain('enabled={me?me.browserHomeEnabled:null}');
    const shellStart = app.indexOf('<Routeelement={<AppShell/>}>');
    expect(shellStart).toBeGreaterThan(-1);
    expect(app.indexOf('<Routepath="/browser"')).toBeGreaterThan(shellStart);
  });
});
