import { prepareExport, exportValidation } from './export';
import type { AssetMap, ExportSnapshot } from './export';

declare global {
  interface Window {
    retExport: {
      prepareExport: typeof prepareExport;
      validation: typeof exportValidation;
    };
  }
}

// One frozen job per page; the native exporter creates and retains a new
// WKWebView for every invocation, independent of editor session/history.
let prepared = false;
window.retExport = Object.freeze({
  async prepareExport(snapshot: ExportSnapshot, assets: AssetMap) {
    if (prepared) throw new Error('Export page already contains a frozen snapshot');
    prepared = true;
    return prepareExport(snapshot, assets);
  },
  validation: exportValidation,
});
