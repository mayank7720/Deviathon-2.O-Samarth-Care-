import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serverRuntime } from '../lib/server-runtime.mjs';
import { handleApi } from '../lib/api.mjs';

test('standalone hosting cannot enable fixture authentication through environment flags', async () => {
  const runtime = serverRuntime({ SAMARTH_AUTH_MODE: 'sites', SAMARTH_LOCAL_DEMO: 'true' });
  const response = await handleApi(new Request('https://care.example/api/access', {
    headers: {
      'oai-authenticated-user-id': 'forged-owner',
      'oai-authenticated-user-email': 'owner@example.test',
    },
  }), runtime.db, { local: runtime.local, env: runtime.env });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.match(body.error, /Supabase login is not configured/);
  assert.equal(body.identity, undefined);
  assert.equal(body.seniors, undefined);
});

test('standalone hosting rejects unauthenticated data access even with forged hosting headers', async () => {
  const runtime = serverRuntime({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  });
  const response = await handleApi(new Request('https://care.example/api/dashboard', {
    headers: { 'oai-authenticated-user-id': 'forged-owner' },
  }), runtime.db, { local: runtime.local, env: runtime.env });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).seniors, undefined);
});
