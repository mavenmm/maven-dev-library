import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  external: [
    "react", "react-dom",
    "@tiptap/react", "@tiptap/pm", "@tiptap/core",
    "@tiptap/starter-kit", "@tiptap/extension-image", "@tiptap/extension-placeholder",
  ],
});
