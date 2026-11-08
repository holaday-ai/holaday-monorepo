# 404 Not Found - HTTP status code reference

The 404 status code tells a client that the server could not find anything at the requested address. It is one of the client error responses, the family of codes from 400 to 499 that point at a problem with the request rather than with the server.

A 404 says nothing about whether the missing resource will come back. A link that pointed to an article which has since been moved, a mistyped path, or a page that never existed all produce the same answer. When a site knows that a resource is gone for good, the 410 Gone status is the more precise choice, and search engines drop such addresses faster.

Servers often return a custom page with the 404 status, so that people who follow a broken link still see the site's navigation, a search box and a few suggestions. The status code itself is what matters to programs: a crawler, a link checker or a monitoring script reads the number, not the friendly text.

Some servers answer 404 on purpose for resources that exist but that the client may not see, instead of 403 Forbidden, so as not to reveal that the resource is there. This is common for private repositories and admin paths.

Clients may cache a 404 response. Whether they do depends on the cache headers the server sends; without them, browsers and proxies apply their own heuristics. A site that fixes a broken address should make sure no long-lived cache keeps serving the old answer.

## Example

A request for /images/cat.png on a server where that file does not exist gets back a response whose status line reads HTTP/1.1 404 Not Found, followed by headers and, usually, a short HTML body explaining what went wrong.

## Related status codes

400 Bad Request means the request itself was malformed. 401 Unauthorized and 403 Forbidden concern who is asking. 405 Method Not Allowed means the address exists but does not accept the method used. 410 Gone means the resource existed and was removed on purpose.

## Specifications and history

The status code has been part of HTTP since its earliest versions and keeps the same meaning in the current HTTP semantics specification. Its reason phrase, Not Found, is only a hint for people; programs must rely on the number alone.
