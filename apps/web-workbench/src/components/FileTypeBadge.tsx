import { cn } from '@/lib/utils';
const FORMATS: Record<string, [string, string]> = {
 pdf: ['PDF','#ed5265'], doc: ['WORD','#508de0'], docx: ['WORD','#508de0'],
 xls: ['EXCEL','#35a578'], xlsx: ['EXCEL','#35a578'], ppt: ['PPT','#e77c57'], pptx: ['PPT','#e77c57'],
 pages: ['PAGES','#ee9b3c'], numbers: ['NUM','#77b94b'], key: ['KEY','#599fc9'], keynote: ['KEY','#599fc9'],
 csv: ['CSV','#42c0ef'], txt: ['TXT','#57479c'], md: ['MD','#57479c'], json: ['JSON','#8172af'], zip: ['ZIP','#a28b6c'],
};
export function fileTypePresentation(filename: string, mime = ''): [string, string] {
 const extension = filename.includes('.') ? filename.split('.').pop()?.toLowerCase() ?? '' : '';
 if (FORMATS[extension]) return FORMATS[extension];
 if (mime.startsWith('image/')) return [extension.length > 0 && extension.length <= 4 ? extension.toUpperCase() : 'IMG','#bd78ac'];
 if (mime.startsWith('video/')) return [extension.length > 0 && extension.length <= 4 ? extension.toUpperCase() : 'VIDEO','#8975c9'];
 if (mime.startsWith('audio/')) return ['AUDIO','#62a9aa'];
 if (mime.includes('pdf')) return FORMATS.pdf;
 if (mime.includes('spreadsheet') || mime.includes('excel')) return FORMATS.xlsx;
 if (mime.includes('word')) return FORMATS.docx;
 if (mime.includes('presentation') || mime.includes('powerpoint')) return FORMATS.pptx;
 if (mime.startsWith('text/')) return FORMATS.txt;
 return [extension.length > 0 && extension.length <= 5 ? extension.toUpperCase() : 'FILE','#94949d'];
}
/** A full square type badge with no nested outline tile. */
export function FileTypeBadge({ filename, mime, className }: { filename: string; mime?: string; className?: string }): JSX.Element {
 const [label, color] = fileTypePresentation(filename, mime);
 return <span aria-hidden className={cn('hd-file-badge', className)} style={{ backgroundColor: color }}>{label}</span>;
}
