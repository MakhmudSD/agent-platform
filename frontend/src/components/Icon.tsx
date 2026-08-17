interface IconProps {
  name: string;
  size?: number;
  filled?: boolean;
  className?: string;
}

// Material Symbols Rounded is a ligature font: the child text (e.g. "forum")
// is the glyph name, not literal text -- see globals.css for the base class
// this composes with. `filled` maps to the design system's FILL axis, used
// for solid vs outline icon states (e.g. an active nav item vs inactive).
export function Icon(props: IconProps) {
  const { name, size = 22, filled = true, className = "" } = props;

  return (
    <span
      className={`material-symbols-rounded ${className}`}
      style={{
        fontSize: size,
        fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' 24`,
      }}
      aria-hidden="true"
    >
      {name}
    </span>
  );
}
