// @vitest-environment happy-dom

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ImageBriefComposer } from './ImageBriefComposer';
import { ImageGenerationSettings } from './ImageGenerationSettings';
import { ImageGoalPicker } from './ImageGoalPicker';
import {
  createImageStudioDraft,
  setImageStudioSetting,
  switchImageCreationGoal,
  type ImageStudioDraft,
  type ImageStudioSettingKey,
} from './image-studio-state';
import type { CommercialImageUse, ImageChangeTarget } from '@/types/image';

afterEach(cleanup);

function Harness(): JSX.Element {
  const [draft, setDraft] = React.useState(() => createImageStudioDraft('inspiration'));
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const settingsTriggerRef = React.useRef<HTMLButtonElement>(null);

  function switchGoal(goal: ImageStudioDraft['goal']): void {
    setDraft((current) => switchImageCreationGoal(current, goal));
  }

  function switchCommercialUse(use: CommercialImageUse): void {
    setDraft((current) => switchImageCreationGoal(current, 'commercial', use));
  }

  function toggleChangeTarget(target: ImageChangeTarget): void {
    setDraft((current) => ({
      ...current,
      changeTargets: current.changeTargets.includes(target)
        ? current.changeTargets.filter((value) => value !== target)
        : [...current.changeTargets, target],
    }));
  }

  function changeSetting<K extends ImageStudioSettingKey>(
    key: K,
    value: ImageStudioDraft[K],
  ): void {
    setDraft((current) => setImageStudioSetting(current, key, value));
  }

  return (
    <>
      <ImageGoalPicker
        value={draft.goal}
        commercialUse={draft.commercialUse}
        onChange={switchGoal}
        onCommercialUseChange={switchCommercialUse}
      />
      <ImageBriefComposer
        draft={draft}
        uploading={false}
        inlineError={null}
        onPromptChange={(prompt) => setDraft((current) => ({ ...current, prompt }))}
        onToggleChangeTarget={toggleChangeTarget}
        onChooseImages={() => undefined}
        onRemoveAttachment={() => undefined}
        onSetSubject={() => undefined}
      />
      <button ref={settingsTriggerRef} type="button" onClick={() => setSettingsOpen(true)}>
        生成设置
      </button>
      <ImageGenerationSettings
        open={settingsOpen}
        draft={draft}
        returnFocusRef={settingsTriggerRef}
        onOpenChange={setSettingsOpen}
        onSettingChange={changeSetting}
      />
    </>
  );
}

describe('image studio form', () => {
  it('leads with the product capability before asking for a creation goal', () => {
    render(<Harness />);

    expect(screen.getByRole('heading', { level: 1, name: '图片创作' })).toBeTruthy();
    expect(screen.getByRole('group', { name: '今天想做什么图' })).toBeTruthy();
  });

  it('presents three clear creation goals before technical settings', () => {
    render(<Harness />);

    const goals = screen.getByRole('group', { name: '今天想做什么图' });
    expect(within(goals).getAllByRole('button')).toHaveLength(3);
    expect(
      within(goals)
        .getByRole('button', { name: /灵感创作/ })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('reveals the subject anchor and five multi-select change targets', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: /锁定主角/ }));

    expect(screen.getByRole('button', { name: '添加主角图' })).toBeTruthy();
    const targets = screen.getByRole('group', { name: '想改什么' });
    expect(within(targets).getAllByRole('button')).toHaveLength(5);
    const background = within(targets).getByRole('button', { name: '背景' });
    expect(background.getAttribute('aria-pressed')).toBe('false');
    await user.click(background);
    expect(background.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows three understandable commercial uses', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: /商业成片/ }));

    const uses = screen.getByRole('group', { name: '选择成片用途' });
    expect(within(uses).getAllByRole('button')).toHaveLength(3);
    expect(within(uses).getByRole('button', { name: '商品图' })).toBeTruthy();
    expect(within(uses).getByRole('button', { name: '海报' })).toBeTruthy();
    expect(within(uses).getByRole('button', { name: '社媒封面' })).toBeTruthy();
  });

  it('shows every connected setting and restores focus after Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const trigger = screen.getByRole('button', { name: '生成设置' });
    await user.click(trigger);

    const dialog = screen.getByRole('dialog', { name: '生成设置' });
    expect(
      within(dialog).getByRole('group', { name: '模型' }).querySelectorAll('button'),
    ).toHaveLength(2);
    expect(
      within(dialog).getByRole('group', { name: '风格' }).querySelectorAll('button'),
    ).toHaveLength(16);
    expect(
      within(dialog).getByRole('group', { name: '比例' }).querySelectorAll('button'),
    ).toHaveLength(5);
    expect(
      within(dialog).getByRole('group', { name: '生成数量' }).querySelectorAll('button'),
    ).toHaveLength(4);

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('keeps goal motion optional and turns the settings dialog into a mobile bottom sheet', () => {
    const goalSource = readFileSync(
      resolve(process.cwd(), 'src/components/image/ImageGoalPicker.tsx'),
      'utf8',
    );
    const settingsSource = readFileSync(
      resolve(process.cwd(), 'src/components/image/ImageGenerationSettings.tsx'),
      'utf8',
    );

    expect(goalSource).toContain('motion-reduce:transition-none');
    expect(goalSource).toContain('motion-reduce:transform-none');
    expect(settingsSource).toContain('max-md:bottom-0');
    expect(settingsSource).toContain('max-md:rounded-b-none');
    expect(settingsSource).toContain('object-contain');
  });
});
