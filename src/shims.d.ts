declare module "*.vue" {
  import type { DefineComponent } from "vue";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/ban-types
  const component: DefineComponent<any, {}, any>;
  export default component;
}
declare module "*.png" {
  export default "" as string;
}
declare module "*.svg" {
  export default "" as string;
}
declare module "*.jpeg" {
  export default "" as string;
}
declare module "*.jpg" {
  export default "" as string;
}
