import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { escapeLike } from './like.js';

describe('escapeLike', () => {
  it('escape %, _, \\', () => {
    assert.equal(escapeLike('100%'), '100\\%');
    assert.equal(escapeLike('a_b'), 'a\\_b');
    assert.equal(escapeLike('a\\b'), 'a\\\\b');
  });
  it('giữ nguyên text thường', () => {
    assert.equal(escapeLike('Nguyen Van A'), 'Nguyen Van A');
    assert.equal(escapeLike(''), '');
  });
  it('escape nhiều ký tự đặc biệt', () => {
    assert.equal(escapeLike('%_%\\'), '\\%\\_\\%\\\\');
  });
});
