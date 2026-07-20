import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const config = await readFile(
  new URL('./nginx-hd-app.conf', import.meta.url),
  'utf8',
);

test('sends screencast WebSockets directly to the Vultr TLS origin', () => {
  const route = config.match(
    /location \^~ \/screencast-ws\/ \{(?<body>[\s\S]*?)\n    \}/,
  );

  assert.ok(route?.groups?.body, 'missing /screencast-ws/ route');
  assert.match(route.groups.body, /proxy_pass https:\/\/207\.148\.70\.106;/);
  assert.match(route.groups.body, /proxy_ssl_name holaday\.ai;/);
  assert.match(route.groups.body, /proxy_ssl_verify on;/);
  assert.match(route.groups.body, /proxy_ssl_verify_depth 3;/);
  assert.match(
    route.groups.body,
    /proxy_ssl_trusted_certificate \/etc\/ssl\/certs\/ca-certificates\.crt;/,
  );
  assert.match(route.groups.body, /proxy_set_header Upgrade \$http_upgrade;/);
  assert.match(route.groups.body, /proxy_set_header Connection \$connection_upgrade;/);
  assert.doesNotMatch(route.groups.body, /proxy_pass https:\/\/holaday\.ai;/);
});
