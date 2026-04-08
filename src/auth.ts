import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcrypt";
import prisma from "@/lib/prisma";
import { ensureDefaultWorkspaceForUser } from "@/lib/workspace";

function requireAuthSecret(): string {
  const secret =
    process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "Missing AUTH_SECRET (or NEXTAUTH_SECRET). Generate a long random string and add it to `.env` — see `.env.example`.",
    );
  }
  return secret;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  secret: requireAuthSecret(),
  trustHost: true,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const emailRaw = credentials?.email;
        const passwordRaw = credentials?.password;
        const email =
          typeof emailRaw === "string" ? emailRaw.trim().toLowerCase() : "";
        const password = typeof passwordRaw === "string" ? passwordRaw : "";
        if (!email || !password) {
          return null;
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user?.passwordHash) {
          return null;
        }

        const passwordMatches = await bcrypt.compare(
          password,
          user.passwordHash,
        );
        if (!passwordMatches) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
  events: {
    async signIn({ user }) {
      const userId = user.id;
      if (typeof userId !== "string" || !userId) {
        return;
      }
      await ensureDefaultWorkspaceForUser(userId);
    },
  },
});
