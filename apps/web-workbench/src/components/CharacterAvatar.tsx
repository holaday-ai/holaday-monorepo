import * as React from 'react';
import { cn } from '@/lib/utils';
const CHARACTERS = ['cute-cloud', 'casual-coffee', 'mature-ivory', 'cute-peach', 'casual-matcha', 'mature-indigo'];
/** Stable fallback character; a member's uploaded photograph always takes precedence. */
export function CharacterAvatar({ name, seed = name, src, className }: { name: string; seed?: string; src?: string | null; className?: string }): JSX.Element {
 const hash = Array.from(seed).reduce((value, char) => (value * 31 + (char.codePointAt(0) ?? 0)) >>> 0, 0);
 const fallback = `/holaday-ui/avatars/${CHARACTERS[hash % CHARACTERS.length]}.webp`;
 const [failed, setFailed] = React.useState<string[]>([]);
 const photo = src && !failed.includes(src) ? src : fallback;
 return <span className={cn('hd-character-avatar', className)} aria-hidden>{failed.includes(photo) ? name.slice(0, 1) : <img data-character={photo === fallback} src={photo} alt="" loading="lazy" decoding="async" onError={() => setFailed((values) => [...values, photo])} />}</span>;
}
