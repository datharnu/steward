export function StewardMark({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Architectural gated vault frame */}
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" stroke="currentColor" strokeWidth="1.75" />
      {/* Interlocking gate bars */}
      <path d="M7.5 8.25H16.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M7.5 15.75H16.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      {/* Center quantum keystone diamond */}
      <path d="M12 9.75L14.25 12L12 14.25L9.75 12L12 9.75Z" fill="var(--color-brand)" />
    </svg>
  );
}
