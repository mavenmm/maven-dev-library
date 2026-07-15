// CSS imported as a string (tsup `.css` -> text loader) for shadow-root injection.
declare module "*.css" {
  const content: string;
  export default content;
}
