// Components and libraries available to the demo. In the app these come from the local database.
import { validatePackage, type ComponentPackage, type JsonObject, type LibraryBundle } from '../../src/index.ts';
import threeBundle from '../../generated/libs/three.json';
import moleculeSource from '../../components/molecule-viewer/component.js?raw';
import moleculeManifest from '../../components/molecule-viewer/manifest.json';
import ethanol from '../../components/molecule-viewer/ethanol.props.json';

export const libraries: Record<string, LibraryBundle> = { three: threeBundle as LibraryBundle };

function load(manifest: unknown, source: string): ComponentPackage {
  const r = validatePackage({ manifest, source });
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

export const moleculeViewer = load(moleculeManifest, moleculeSource);
export const ethanolProps = ethanol as unknown as JsonObject;
