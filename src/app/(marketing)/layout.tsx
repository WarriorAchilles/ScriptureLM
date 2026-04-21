import { AuthBrandFont } from "@/components/auth-brand-font";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuthBrandFont>{children}</AuthBrandFont>;
}
