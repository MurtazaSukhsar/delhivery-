/** Farwings delivery mark: a box truck on a blue tile. Used until a client adds their own logo. */
import { useId } from 'react';

export function BrandMark({ size = 32, className }: { size?: number; className?: string }) {
  const gid = 'bm' + useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" className={className ?? 'shrink-0'}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4f83ff" />
          <stop offset="1" stopColor="#1b44ad" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill={`url(#${gid})`} />
      <path d="M7 15.5a2.5 2.5 0 0 1 2.5-2.5H21a2.5 2.5 0 0 1 2.5 2.5V25H7z" fill="#fff" />
      <path d="M23.5 17.5h4.6c.6 0 1.1.3 1.4.7l2.5 3.4c.2.3.3.6.3 1V25h-8.8z" fill="#fff" fillOpacity=".88" />
      <circle cx="13.5" cy="26.5" r="3.2" fill="#1b44ad" stroke="#fff" strokeWidth="2" />
      <circle cx="27" cy="26.5" r="3.2" fill="#1b44ad" stroke="#fff" strokeWidth="2" />
      <path d="M11 17.5h8M11 20.5h5" stroke="#4f83ff" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
