/**
 * F1-followup — guards `looksLikeBrowserTakeoverPrompt`. The earlier
 * regex-only form ("请(?:您|你|帮)?接管…") missed real model outputs
 * like "直接接管浏览器自己完成登录" because there was no leading 请,
 * which led to the loop returning status='completed' under an
 * unfinished login (Brave released, user staring at "请接管" with no
 * live session). Tests here pin down the broader heuristic against
 * regression.
 */

import { describe, expect, it } from 'vitest';
import { looksLikeBrowserTakeoverPrompt } from './agent-loop.js';

describe('looksLikeBrowserTakeoverPrompt', () => {
  describe('matches takeover prompts the model actually emits', () => {
    it('"接管浏览器" without leading 请', () => {
      expect(
        looksLikeBrowserTakeoverPrompt('直接接管浏览器自己完成登录'),
      ).toBe(true);
    });

    it('"完成登录" alone', () => {
      expect(looksLikeBrowserTakeoverPrompt('请你完成登录后告诉我')).toBe(true);
    });

    it('compound "请告诉我...入口...登录...或者接管"', () => {
      expect(
        looksLikeBrowserTakeoverPrompt(
          '请告诉我你用哪个入口登录，或者直接接管浏览器',
        ),
      ).toBe(true);
    });

    it('"选择.*入口.*登录" via co-occurrence (登录 + 选择 + 入口)', () => {
      expect(
        looksLikeBrowserTakeoverPrompt(
          '需要你选择一个入口登录后端，我来继续后续步骤',
        ),
      ).toBe(true);
    });

    it('"请登录" as standalone', () => {
      expect(looksLikeBrowserTakeoverPrompt('请登录抖店后台')).toBe(true);
    });

    it('"扫码登录"', () => {
      expect(looksLikeBrowserTakeoverPrompt('需要扫码登录后才能访问')).toBe(
        true,
      );
    });

    it('English "please log in"', () => {
      expect(looksLikeBrowserTakeoverPrompt('Please log in to continue')).toBe(
        true,
      );
    });

    it('English "take over the browser"', () => {
      expect(
        looksLikeBrowserTakeoverPrompt(
          'I cannot proceed; please take over the browser to sign in',
        ),
      ).toBe(true);
    });
  });

  describe('does NOT match completed-task summaries that mention login', () => {
    it('past-tense "已登录"', () => {
      expect(
        looksLikeBrowserTakeoverPrompt(
          '已经登录抖店后台，并选择了商品类目，找到 3 条记录',
        ),
      ).toBe(false);
    });

    it('past-tense "已成功登录"', () => {
      expect(
        looksLikeBrowserTakeoverPrompt(
          '已成功登录罗盘，下面是昨晚的核心指标',
        ),
      ).toBe(false);
    });

    it('past-tense "登录成功"', () => {
      expect(
        looksLikeBrowserTakeoverPrompt(
          '登录成功，已选择目标商品并提交了订单',
        ),
      ).toBe(false);
    });

    it('English "successfully logged in"', () => {
      expect(
        looksLikeBrowserTakeoverPrompt(
          'Successfully logged in and selected the menu option',
        ),
      ).toBe(false);
    });

    it('long completed report that mentions both login and select incidentally', () => {
      // Length cap dodges the co-occurrence guard for genuine reports.
      const longReport =
        '已完成抖音直播复盘任务。' +
        '我登录了抖音电商罗盘后台，选择了昨晚 20:00-23:00 的直播场次，' +
        '提取出 GMV、UV、转化率等核心指标。'.repeat(30);
      expect(looksLikeBrowserTakeoverPrompt(longReport)).toBe(false);
    });
  });

  describe('does NOT match unrelated text', () => {
    it('plain question without login context', () => {
      expect(looksLikeBrowserTakeoverPrompt('请告诉我你的目标受众？')).toBe(
        false,
      );
    });

    it('empty', () => {
      expect(looksLikeBrowserTakeoverPrompt('')).toBe(false);
    });

    it('login keyword alone (no ask)', () => {
      expect(looksLikeBrowserTakeoverPrompt('登录页面是 example.com/login')).toBe(
        false,
      );
    });

    it('ask keyword alone (no login)', () => {
      expect(looksLikeBrowserTakeoverPrompt('请告诉我你想要什么样式')).toBe(
        false,
      );
    });
  });
});
