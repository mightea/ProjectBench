export function Logo({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#2F5BEA" />
      <rect x="12" y="22" width="40" height="7" rx="2" fill="#fff" />
      <rect x="16" y="29" width="5" height="19" rx="1.5" fill="#fff" />
      <rect x="43" y="29" width="5" height="19" rx="1.5" fill="#fff" />
      <rect x="21" y="38" width="22" height="3.5" rx="1" fill="#fff" opacity="0.7" />
      <rect x="24" y="14" width="9" height="8" rx="1.5" fill="#fff" opacity="0.85" />
      <rect x="35" y="17" width="6" height="5" rx="1.5" fill="#fff" opacity="0.85" />
    </svg>
  );
}
