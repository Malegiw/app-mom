/** The Notula mark: a page of minutes with a recording dot. */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="15" fill="var(--brand-blue)" />
      <rect x="17" y="18" width="30" height="5" rx="2.5" fill="#ffffff" />
      <rect x="17" y="29.5" width="30" height="5" rx="2.5" fill="#ffffff" />
      <rect x="17" y="41" width="15" height="5" rx="2.5" fill="#ffffff" />
      <circle cx="43" cy="43.5" r="6.5" fill="var(--brand-orange)" />
    </svg>
  );
}
