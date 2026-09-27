import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './harness.mjs';

test('a guarded page remembers where you were going', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/app/dashboard`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/login?next=%2Fapp%2Fdashboard');
  } finally { await stop(); }
});

test('the query string survives, because a report link carries one', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/app/plan/yuval?subject=%D7%9E%D7%AA%D7%9E%D7%98%D7%99%D7%A7%D7%94`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location'), /^\/login\?next=%2Fapp%2Fplan%2Fyuval%3Fsubject%3D/);
  } finally { await stop(); }
});
