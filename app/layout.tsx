import "./globals.css";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "Volvo Cars UK configuration Configurator", description: "AI car configurator MVP" };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
