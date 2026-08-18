export function RoutyLogo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="var(--accent)" />
      <path
        d="M5 23c2.5-6 6-9 11-9s8.5 3 11 9"
        stroke="var(--accent-strong)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeDasharray="1.2 3.4"
        fill="none"
        opacity="0.6"
      />
      <ellipse cx="16" cy="21.5" rx="6" ry="5" fill="#fff" />
      <circle cx="8.7" cy="13.2" r="2.7" fill="#fff" />
      <circle cx="13.2" cy="9.6" r="2.9" fill="#fff" />
      <circle cx="18.8" cy="9.6" r="2.9" fill="#fff" />
      <circle cx="23.3" cy="13.2" r="2.7" fill="#fff" />
    </svg>
  );
}
