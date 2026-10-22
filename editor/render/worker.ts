import type { RenderJob } from "./client";
import { renderDocument } from "./document";
import { renderMath } from "./math-worker";
const scope = globalThis as unknown as {
  onmessage: (event: { data: { id: number; job: RenderJob } }) => void;
  postMessage: (value: unknown) => void;
};
scope.onmessage = ({ data: { id, job } }) => {
  try {
    scope.postMessage({
      id,
      html:
        job.kind === "document"
          ? renderDocument(job.source, renderMath, job.assetToken)
          : renderMath(job.text, job.displayMode),
    });
  } catch {
    scope.postMessage({ id, error: true });
  }
};
