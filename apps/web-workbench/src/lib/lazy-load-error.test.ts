import { describe, expect, it } from 'vitest';
import { isLazyLoadError, lazyLoadErrorCopy } from './lazy-load-error';

describe('lazy load error helpers', () => {
  it('detects dynamic import failures from modern browsers', () => {
    expect(
      isLazyLoadError(
        new TypeError(
          'Failed to fetch dynamically imported module: https://holaday.ai/assets/SettingsPage.js',
        ),
      ),
    ).toBe(true);
    expect(
      isLazyLoadError('Importing a module script failed.'),
    ).toBe(true);
  });

  it('detects legacy chunk load failures', () => {
    expect(isLazyLoadError(new Error('ChunkLoadError: Loading chunk 42 failed.'))).toBe(
      true,
    );
    expect(isLazyLoadError({ message: 'error loading dynamically imported module' })).toBe(
      true,
    );
  });

  it('keeps unrelated render errors generic', () => {
    expect(isLazyLoadError(new Error('Cannot read properties of null'))).toBe(false);
    expect(lazyLoadErrorCopy(new Error('Cannot read properties of null'), '任务详情')).toEqual({
      title: '任务详情加载失败',
      body: '页面渲染时遇到异常。刷新后仍然失败的话，请稍后再试或联系支持。',
      actionLabel: '刷新重试',
    });
  });

  it('uses update-specific copy for chunk failures', () => {
    expect(
      lazyLoadErrorCopy(
        new Error('Failed to fetch dynamically imported module'),
        '任务详情',
      ),
    ).toEqual({
      title: '任务详情资源已更新',
      body: '当前打开的版本和服务器上的最新资源不一致。刷新后会加载最新版本，已输入的内容请先确认保存。',
      actionLabel: '刷新页面',
    });
  });
});
