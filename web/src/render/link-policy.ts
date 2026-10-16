/** Shared parsing policy; navigation remains the responsibility of each host. */
export function validateMarkdownLink(destination: string): boolean {
  return !/[\u0000-\u0020\u007f]/.test(destination)
    && (!/^[a-z][a-z\d+.-]*:/i.test(destination) || /^(?:https?|mailto):/i.test(destination)
      || /^file:\/\/(?:\/|localhost\/)/i.test(destination));
}
