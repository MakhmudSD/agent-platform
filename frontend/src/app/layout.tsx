import "./globals.css";
import { AuthProvider } from "@/lib/auth";

export const metadata = {
  title: "Employee Request Assistant",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans text-slate-900">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
