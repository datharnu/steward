import type { Metadata } from "next";
import localFont from "next/font/local";
import { Header } from "@/components/header";
import "./globals.css";

const sans = localFont({
  src: "../node_modules/@fontsource/familjen-grotesk/files/familjen-grotesk-latin-400-normal.woff2",
  variable: "--font-sans",
  display: "swap",
  weight: "400",
});

const serif = localFont({
  src: "../node_modules/@fontsource/newsreader/files/newsreader-latin-400-italic.woff2",
  variable: "--font-serif",
  display: "swap",
  style: "italic",
  weight: "400",
});

const mono = localFont({
  src: "../node_modules/@fontsource/fragment-mono/files/fragment-mono-latin-400-normal.woff2",
  variable: "--font-mono",
  display: "swap",
  weight: "400",
});

export const metadata: Metadata = {
  title: "Steward",
  description: "An accounts-payable clerk that can carry an invoice and cannot open the drawer.",
};

const themeScript = `(function(){try{var t=localStorage.getItem("steward-theme");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";}document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Header />
        {children}
      </body>
    </html>
  );
}
