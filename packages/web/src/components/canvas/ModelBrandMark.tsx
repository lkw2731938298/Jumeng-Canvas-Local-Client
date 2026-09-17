/** White interlocking-loop mark for canvas model select (screenshot style). */
export function ModelBrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.15"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M12 4.2a4.4 4.4 0 0 1 2.2 8.2" />
      <path d="M12 4.2a4.4 4.4 0 0 0-2.2 8.2" />
      <path d="M7.2 9.6a4.4 4.4 0 1 0 4.05 6.55" />
      <path d="M16.8 9.6a4.4 4.4 0 1 1-4.05 6.55" />
      <path d="M9.8 12.35a4.4 4.4 0 0 0 4.4 0" />
    </svg>
  );
}
