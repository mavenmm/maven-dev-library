import { defineConfig } from "tsup";

export default defineConfig({
  entry: { core: "src/core/index.ts", ui: "src/ui/index.ts" },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  // Import styles.css as a string so the widget can inject it into its shadow root.
  loader: { ".css": "text" },
  external: [
    "react", "react-dom",
    "@tiptap/react", "@tiptap/pm", "@tiptap/core",
    "@tiptap/starter-kit", "@tiptap/extension-image", "@tiptap/extension-placeholder",
  ],
});
