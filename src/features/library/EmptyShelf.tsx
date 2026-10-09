export function EmptyShelf() {
  return (
    <svg className="empty-shelf" viewBox="0 0 360 170" role="img" aria-label="An empty wooden bookshelf">
      <defs>
        <linearGradient id="es-wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7a5233" /><stop offset="1" stopColor="#4a2f1b" /></linearGradient>
        <linearGradient id="es-back" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2b1c12" /><stop offset="1" stopColor="#3a2619" /></linearGradient>
      </defs>
      <rect x="20" y="12" width="320" height="146" rx="6" fill="url(#es-back)" stroke="#5e3d25" strokeWidth="6" />
      <rect x="14" y="76" width="332" height="12" rx="2" fill="url(#es-wood)" />
      <rect x="14" y="146" width="332" height="14" rx="2" fill="url(#es-wood)" />
      <rect x="14" y="88" width="332" height="6" fill="#000" opacity=".25" />
      {/* a leaning bookend and a lonely candle-less lamp glow */}
      <rect x="296" y="30" width="10" height="46" fill="#8b6240" /><rect x="296" y="66" width="26" height="10" fill="#8b6240" />
      <rect x="296" y="98" width="10" height="48" fill="#8b6240" /><rect x="296" y="136" width="26" height="10" fill="#8b6240" />
      <circle cx="70" cy="48" r="18" fill="#f2c879" opacity=".12" />
      <path d="M52 76c4-8 8-8 12 0M80 76c3-6 6-6 9 0" stroke="#d9b98a" strokeWidth="1.5" fill="none" opacity=".5" />
    </svg>
  );
}
