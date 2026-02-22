const test = require('node:test');
const assert = require('node:assert/strict');

const { getUserId } = require('../src/user-context');

test('getUserId prefers AMAPRICE_USER_ID and sanitizes', () => {
  const prev = process.env.AMAPRICE_USER_ID;
  process.env.AMAPRICE_USER_ID = 'Marcel Heinz+Dev';
  const id = getUserId();
  assert.equal(id, 'marcel-heinz-dev');
  if (prev === undefined) delete process.env.AMAPRICE_USER_ID;
  else process.env.AMAPRICE_USER_ID = prev;
});

