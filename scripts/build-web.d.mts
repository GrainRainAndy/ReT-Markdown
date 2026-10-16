export function selectEntry(directory?: string): Promise<string>;
export function copyRendererResources(outdir: string): Promise<void>;
export function buildWeb(options?: { outdir?: string; entry?: string }): Promise<void>;
