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
            below, and removes any network dependency from the build step. */}
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,1,0&display=swap"
        />
      </head>
      <body className="font-sans text-ink bg-app">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
