// Image files imported by the renderer resolve to their URL (Vite handles the import).
declare module '*.png' {
  const url: string;
  export default url;
}
