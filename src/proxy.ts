import { auth } from "@/auth";

export const proxy = auth((request) => {
  if (request.auth) {
    return;
  }
  const signInUrl = new URL("/sign-in", request.nextUrl.origin);
  signInUrl.searchParams.set(
    "callbackUrl",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return Response.redirect(signInUrl);
});

export const config = {
  matcher: ["/workspace/:path*"],
};
