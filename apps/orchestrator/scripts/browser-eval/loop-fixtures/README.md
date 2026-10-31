# Loop audit fixtures

Offline fixtures exercise the entire runner/loop/verification pipeline; they are
not evidence that a remote website is available. `--live` uses public websites,
with the local the-internet replica allowed only when that site cannot operate.

`vendor/jquery-1.11.3.min.js` and `vendor/jquery.jscroll.min.js` are copied without
modification from https://github.com/saucelabs/the-internet at
`d638883d19d4cab734d786e53b5eef1f105ae070`. Their upstream license notices are retained.
The infinite-scroll markup and alerts use that application's examples; the
replica returns deterministic paragraphs instead of Faker-generated prose.
The local form and same-origin iframe isolate HTML controls without CDN dependencies.

No login state, credentials, paid model, production database or storage is used.
