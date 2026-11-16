/** version.ts — injectée au bundle (esbuild --define), « -dev » quand on lance les sources avec tsx. */
declare const __ARCHIVE_NODE_VERSION__: string | undefined;

export const VERSION: string =
  typeof __ARCHIVE_NODE_VERSION__ === "string" ? __ARCHIVE_NODE_VERSION__ : "0.1.0-dev";
