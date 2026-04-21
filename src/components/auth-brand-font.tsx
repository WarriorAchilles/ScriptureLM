import { Literata } from "next/font/google";

const literata = Literata({
  subsets: ["latin"],
  variable: "--font-auth",
  display: "swap",
});

export function AuthBrandFont({ children }: { children: React.ReactNode }) {
  return <div className={literata.variable}>{children}</div>;
}
