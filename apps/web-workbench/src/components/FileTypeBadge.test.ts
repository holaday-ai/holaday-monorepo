import { describe, expect, it } from 'vitest';
import { fileTypePresentation } from './FileTypeBadge';
describe('file type presentation', () => {
 it.each([['a.PDF','PDF'],['a.docx','WORD'],['a.xlsx','EXCEL'],['a.pages','PAGES'],['a.numbers','NUM'],['a.pptx','PPT'],['a.key','KEY']])('labels %s as %s', (name,label) => expect(fileTypePresentation(name)[0]).toBe(label));
 it('uses MIME when a filename has no extension and safely handles unknown types', () => {
  expect(fileTypePresentation('报告','application/pdf')[0]).toBe('PDF');
  expect(fileTypePresentation('原图','image/png')[0]).toBe('IMG');
  expect(fileTypePresentation('untitled')[0]).toBe('FILE');
 });
});
