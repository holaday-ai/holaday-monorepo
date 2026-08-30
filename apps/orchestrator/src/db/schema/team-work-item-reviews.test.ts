import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/mysql-core';
import { describe, expect, it } from 'vitest';
import { teamWorkItemReviews } from './team-work-item-reviews.js';

describe('team work item review attempts schema', () => {
  it('stores a bounded unsigned attempt and permits one review per submission attempt', () => {
    const columns = getTableColumns(teamWorkItemReviews);
    expect(columns.reviewAttempt.notNull).toBe(true);
    expect(columns.reviewAttempt.default).toBe(1);
    expect(columns.reviewAttempt.getSQLType()).toBe('int unsigned');

    const indexes = getTableConfig(teamWorkItemReviews).indexes;
    expect(
      indexes.some((index) => index.config.name === 'uk_team_work_item_reviews_submission'),
    ).toBe(false);
    const attemptIndex = indexes.find(
      (index) => index.config.name === 'uk_team_work_item_reviews_submission_attempt',
    );
    expect(attemptIndex?.config.unique).toBe(true);
    expect(
      attemptIndex?.config.columns.map((column) => ('name' in column ? column.name : null)),
    ).toEqual(['submission_id', 'review_attempt']);
  });
});
