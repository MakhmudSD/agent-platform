interface LogoProps {
  size?: number;
}

// Per design_handoff_approval_flow/README.md: 32x32 mark, radius 10, ink
// fill, containing a 10x10 accent square rotated 45deg. Proportions scale
// with `size` so smaller renderings (e.g. the login page) stay correct.
export function Logo(props: LogoProps) {
  const { size = 32 } = props;
  const radius = size * (10 / 32);
  const inner = size * (10 / 32);

  return (
    <div
      style={{ width: size, height: size, borderRadius: radius, background: "#191817" }}
      className="flex items-center justify-center shrink-0"
      aria-hidden="true"
    >
      <span style={{ width: inner, height: inner, background: "#0E7A68", borderRadius: 2, transform: "rotate(45deg)" }} />
    </div>
  );
}
