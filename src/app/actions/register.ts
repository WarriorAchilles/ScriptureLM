"use server";

import bcrypt from "bcrypt";
import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";

const BCRYPT_COST = 12;

export type RegisterState = { error?: string };

export async function registerAction(
  _prevState: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  try {
    const userCount = await prisma.user.count();
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    await prisma.user.create({
      data: {
        email,
        passwordHash,
        role: userCount === 0 ? "admin" : "user",
      },
    });
  } catch (error: unknown) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof (error as { code: unknown }).code === "string"
        ? (error as { code: string }).code
        : undefined;
    if (code === "P2002") {
      return { error: "An account with this email already exists." };
    }
    throw error;
  }

  redirect("/sign-in?registered=1");
}
