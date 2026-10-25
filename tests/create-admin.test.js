process.env.JWT_SECRET = 'a'.repeat(64);
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAdmin } = require('../scripts/create-admin');

function makeUserModel(initial = []) {
  const store = initial.map((u) => ({ ...u, save: async function () { this.saved = true; } }));
  const Model = function (data) {
    const instance = { ...data, saved: false, save: async function () { this.saved = true; } };
    store.push(instance);
    return instance;
  };
  Model.findOne = async ({ email }) => store.find((u) => u.email === email) || null;
  Model._store = store;
  return Model;
}

test('createAdmin refuses to overwrite existing admin without --reset', async () => {
  const UserModel = makeUserModel([{ email: 'admin@example.com', role: 'super_admin' }]);
  await assert.rejects(
    createAdmin({ email: 'admin@example.com', password: 'a'.repeat(14), reset: false, env: { NODE_ENV: 'test' }, UserModel }),
    /already exists/i
  );
});

test('createAdmin succeeds with --reset on existing admin', async () => {
  const UserModel = makeUserModel([{ email: 'admin@example.com', role: 'super_admin' }]);
  const result = await createAdmin({ email: 'admin@example.com', password: 'a'.repeat(14), reset: true, env: { NODE_ENV: 'test' }, UserModel });
  assert.equal(result.action, 'reset');
  assert.equal(UserModel._store[0].role, 'super_admin');
  assert.equal(UserModel._store[0].status, 'active');
  assert.equal(UserModel._store[0].saved, true);
});

test('createAdmin creates new admin', async () => {
  const UserModel = makeUserModel([]);
  const result = await createAdmin({ email: 'new@example.com', password: 'a'.repeat(14), env: { NODE_ENV: 'test' }, UserModel });
  assert.equal(result.action, 'created');
  assert.equal(UserModel._store.length, 1);
});


