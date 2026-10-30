export default function CareMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.55"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {/* The joined palms and thumbs make the heart silhouette. */}
      <path d="M12 20.8c-1.7-1.1-8.4-5.2-8.4-10.7 0-2.9 1.7-4.8 4.2-4.8 2 0 3.4 1.4 4.2 3.3.8-1.9 2.2-3.3 4.2-3.3 2.5 0 4.2 1.9 4.2 4.8 0 5.5-6.7 9.6-8.4 10.7Z" />
      <path d="M5.2 11.2c1.4-.7 2.8-.4 4.2.7l2.6 2.1 2.6-2.1c1.4-1.1 2.8-1.4 4.2-.7" />
      <path d="M6.2 14.4c1.4.1 2.5-.4 3.4-1.4m8.2 1.4c-1.4.1-2.5-.4-3.4-1.4" />
    </svg>
  );
}
