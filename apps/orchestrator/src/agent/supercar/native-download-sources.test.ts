import { expect, it } from 'vitest';
import { nativeDownloadResponseSourcesForPage } from '../../../../../packages/browser-driver/src/native-download-sources.js';

const id = 'synthetic_spreadsheet_abcdefghijklmnopqrstuvwxyz0123456789';
const page = `https://docs.google.com/spreadsheets/d/${id}/edit?gid=42#gid=42`;
const download = `https://doc-0s-ao-sheets.googleusercontent.com/export/opaque/${id}?format=csv&id=${id}&gid=42&dat=temporary`;
const commit = 'deadbeef'.repeat(5);
const github = `https://github.com/fixture-owner/fixture-repo/blob/${commit}/reports/fixture.json`;
const raw = `https://raw.githubusercontent.com/fixture-owner/fixture-repo/${commit}/reports/fixture.json?token=temporary`;
it('binds the GitHub download host to the exact selected repository, commit and file', () => {
  expect(nativeDownloadResponseSourcesForPage(github)!.accepts(raw)).toBe(true);
  expect(nativeDownloadResponseSourcesForPage(github.replace(commit, 'main'))).toBeUndefined();
});
it.each([
  raw.replace('https:', 'http:'),
  raw.replace('raw.githubusercontent.com', 'raw.githubusercontent.com.evil.test'),
  raw.replace('/fixture-repo/', '/other-repo/'),
  raw.replace('/fixture-owner/', '/other-owner/'),
  raw.replace(commit, '01234567'.repeat(5)),
  raw.replace('/fixture.json', '/other.json'),
  raw.replace('https://', 'https://user:password@'),
  `${raw}#fragment`,
])('rejects a different GitHub resource or download origin: %s', (destination) => {
  expect(nativeDownloadResponseSourcesForPage(github)!.accepts(destination)).toBe(false);
});
it('permits only this spreadsheet export without persisting its signed URL or granting a page origin', () => {
  const policy = nativeDownloadResponseSourcesForPage(page)!;
  expect(policy.patterns).toEqual(['https://doc-*-sheets.googleusercontent.com/export/*']);
  expect(policy.accepts(download)).toBe(true);
});
it.each([
  download.replace('https:', 'http:'),
  download.replace('.com/', '.com.evil.test/'),
  download.replace('doc-0s-ao-sheets.', 'unrelated.'),
  download.replace('https://', 'https://user:password@'),
  download.replace('.com/', '.com:8443/'),
  download.replace('/export/', '/other/'),
  download.replace(`/${id}?`, '/different-spreadsheet?'),
  download.replace(`id=${id}`, 'id=another-spreadsheet'),
  `${download}&id=${id}`,
  download.replace('format=csv', 'format=xlsx'),
  `${download}&format=csv`,
  download.replace('gid=42', 'gid=43'),
  `${download}&gid=42`,
  `${download}#fragment`,
  'not a URL',
])('rejects a destination outside the selected export scope: %s', (destination) => {
  expect(nativeDownloadResponseSourcesForPage(page)!.accepts(destination)).toBe(false);
});
it.each([
  page.replace('docs.google.com', 'docs.google.com.evil.test'),
  page.replace('https:', 'http:'),
  page.replace('/spreadsheets/', '/document/'),
  page.replace('#gid=42', '#gid=43'),
  'https://example.test/',
  'not a URL',
])('does not grant provider exports to an unrecognized page: %s', (source) => {
  expect(nativeDownloadResponseSourcesForPage(source)).toBeUndefined();
});
