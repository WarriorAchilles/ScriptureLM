import { AuthBrandFont } from "@/components/auth-brand-font";

export default function SignInLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuthBrandFont>{children}</AuthBrandFont>;
}
