export function safeLink(value: string): boolean {
  if (!value || /[\u0000-\u0020\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "mailto:"
      ? !!url.pathname
      : ["http:", "https:"].includes(url.protocol) && !!url.hostname;
  } catch {
    return false;
  }
}
