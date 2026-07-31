'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeSubscriptionUrl } = require('../src/services/subFetcher');

test('旧 WestData 域名迁移到 api.sublink.dev 并保留请求参数', () => {
  const sourceUrl = 'https://api.wd-blue.com/WestData.conf?target=shadowrocket&url=https%3A%2F%2Fexample.com%2Fsubscribe%2Ffake-token';
  const migrated = new URL(normalizeSubscriptionUrl(sourceUrl));

  assert.equal(migrated.hostname, 'api.sublink.dev');
  assert.equal(migrated.pathname, '/WestData.conf');
  assert.equal(migrated.searchParams.get('target'), 'shadowrocket');
  assert.equal(migrated.searchParams.get('url'), 'https://example.com/subscribe/fake-token');
});

test('非目标域名保持原样', () => {
  const sourceUrl = 'https://example.com/profile.conf?target=shadowrocket';
  assert.equal(normalizeSubscriptionUrl(sourceUrl), sourceUrl);
});

test('仅允许 http 和 https 订阅协议', () => {
  assert.throws(
    () => normalizeSubscriptionUrl('file:///etc/passwd'),
    /仅支持 http 或 https/,
  );
});
