declare module '*.vue' {
    import type { DefineComponent } from 'vue'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/ban-types
    const component: DefineComponent<any, {}, any>
    export default component
}

/** Allow importing PNG (and other image) files as data-URL strings via esbuild. */
declare module '*.png' {
  const value: string;
  export default value;
}

declare module '*.jpg' {
  const value: string;
  export default value;
}

/** Wavefront OBJ meshes (the scout pin) resolve to their emitted file URL. */
declare module '*.obj' {
  const value: string;
  export default value;
}