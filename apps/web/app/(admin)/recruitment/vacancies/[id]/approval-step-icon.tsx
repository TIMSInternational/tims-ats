/** The glyph inside an approval step's status circle (white on a solid status token). */
export function ApprovalStepIcon({ icon }: { icon: 'check' | 'x' | 'clock' }) {
  return (
    <svg
      className="size-3.5 text-white"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      {icon === 'check' && <path d="m4.5 12.75 6 6 9-13.5" />}
      {icon === 'x' && <path d="M6 18L18 6M6 6l12 12" />}
      {icon === 'clock' && (
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </>
      )}
    </svg>
  );
}
