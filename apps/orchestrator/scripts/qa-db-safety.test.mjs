import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertSafeQaDatabase } from './qa-db-safety.mjs';

describe('assertSafeQaDatabase', () => {
  it('allows loopback databases used by local QA', () => {
    assert.doesNotThrow(() =>
      assertSafeQaDatabase('mysql://user:pass@127.0.0.1:3306/holaday'));
    assert.doesNotThrow(() =>
      assertSafeQaDatabase('mysql://user:pass@localhost:3306/holaday'));
  });

  it('rejects remote databases by default', () => {
    assert.throws(
      () => assertSafeQaDatabase('mysql://user:pass@db.example.com:3306/holaday'),
      /refusing remote database/i,
    );
  });

  it('requires both an explicit override and a dedicated QA database name', () => {
    assert.throws(
      () => assertSafeQaDatabase('mysql://user:pass@db.example.com:3306/holaday', {
        allowRemote: true,
      }),
      /dedicated QA database/i,
    );
    assert.doesNotThrow(() =>
      assertSafeQaDatabase('mysql://user:pass@db.example.com:3306/holaday_qa', {
        allowRemote: true,
      }));
  });
});
