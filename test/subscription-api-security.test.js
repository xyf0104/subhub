'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const apiRouter = require('../src/routes/api');

test('订阅 API 同时隐藏路径型与查询型 Token', () => {
  const source = {
    id: 'safe-test',
    name: '测试订阅',
    url: 'https://example.com/subscribe/path-secret/profile.conf?token=query-secret',
    sourceType: 'shadowrocket-conf',
  };
  const serialized = apiRouter.serializeSubscription(source);

  assert.equal(serialized.url, 'https://example.com/••••••.conf');
  assert.equal(JSON.stringify(serialized).includes('path-secret'), false);
  assert.equal(JSON.stringify(serialized).includes('query-secret'), false);
  assert.equal(source.url.includes('path-secret'), true);
});

test('无扩展名订阅只展示源站', () => {
  const serialized = apiRouter.serializeSubscription({
    url: 'https://example.com/subscribe/fake-token',
  });
  assert.equal(serialized.url, 'https://example.com/••••••');
});
