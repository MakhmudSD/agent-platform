import "./globals.css";
import { AuthProvider } from "@/lib/auth";

export const metadata = {
  title: "AX Platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Plain <link> tags rather than next/font/google -- next/font
            fetches font files during `next build` itself, and that fetch
            hung indefinitely in this environment (build never got past
            printing its own banner). A <link> defers font loading to the
            browser at request time, same as Material Symbols already does
            below, and removes any network dependency from the build step.

            Two separate stylesheets, two different font-display values --
            they can't share one `display` setting:

            Text faces (Instrument Sans, IBM Plex Mono) use display=optional.
            swap paints with the fallback font immediately and then snaps to
            the real one the instant it arrives, and because the two don't
            share letter widths, every fixed-width element (the sidebar
            rail, nav labels, table columns) visibly reflows for a frame on
            every load. optional gives the browser a short window to use the
            font if it's already cached and otherwise just keeps the
            fallback for that page view -- no mid-render swap, so nothing
            reflows.

            Material Symbols can't use optional, though -- it's a ligature
            icon font, so without it every icon renders as literal text
            ("space_dashboard", "receipt_long") instead of a glyph, which is
            worse than the reflow this was meant to fix. It gets display=block
            instead: a brief invisible gap while it loads, then the icon
            glyph -- never the ligature text, and once cached (same as any
            repeat visit) it's already there for first paint. */}
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=optional"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,1,0&display=block"
        />
      </head>
      <body className="font-sans text-ink bg-app">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
