import type { Metadata } from "next";
import { Montserrat, Open_Sans } from "next/font/google";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import "./globals.css";

/**
 * Fonts loaded via next/font/google — zero layout shift, self-hosted.
 *
 * --font-sans  → Montserrat  (headings, labels, UI chrome)
 * --font-serif → Open Sans   (body copy, descriptions, data)
 *
 * These variable names match exactly what globals.css uses via
 * `fontFamily: "var(--font-sans)"` throughout all components.
 */

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  weight: ["400", "500", "600", "700", "800", "900"],
});

const openSans = Open_Sans({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "ShambaFlow — Digital Infrastructure for Organised Agricultural Supply",
  description:
    "ShambaFlow connects verified cooperatives to structured buyers through a trusted CRM, dynamic tender marketplace, and reputation system built for African agriculture.",
  keywords: ["cooperative", "agriculture", "Kenya", "tender", "marketplace", "CRM"],
  authors: [{ name: "ShambaFlow" }],
  openGraph: {
    title: "ShambaFlow",
    description: "Digital Infrastructure for Organised Agricultural Supply",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${montserrat.variable} ${openSans.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
