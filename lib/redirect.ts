// Guards against open redirects: only allow same-origin, path-only `next`
// targets. Anything absolute ("https://evil.com"), protocol-relative ("//x"),
// or empty falls back to "/".
export function safeNext(next: string | null | undefined): string {
  if (!next) return "/";
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}
