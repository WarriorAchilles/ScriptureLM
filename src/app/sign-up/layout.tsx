import { AuthBrandFont } from "@/components/auth-brand-font";

export default function SignUpLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuthBrandFont>{children}</AuthBrandFont>;
}
