// src/ui/feedback/feedback-composer.tsx
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { useCallback, useRef, useEffect, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
function FeedbackComposer({ uploadImage, onChange, placeholder }) {
  const fileInputRef = useRef(null);
  const editorRef = useRef(null);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState(null);
  const insertImageFile = useCallback(async (file) => {
    const editor2 = editorRef.current;
    if (!editor2) return;
    setUploadError(null);
    setUploading((n) => n + 1);
    try {
      const { url } = await uploadImage(file);
      editor2.chain().focus().setImage({ src: url }).run();
    } catch (err) {
      setUploadError(`Couldn't add screenshot: ${err.message || "upload failed"}`);
    } finally {
      setUploading((n) => Math.max(0, n - 1));
    }
  }, [uploadImage]);
  const uploadImageItems = useCallback((items) => {
    if (!items) return false;
    let found = false;
    for (const item of Array.from(items)) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          found = true;
          void insertImageFile(file);
        }
      }
    }
    return found;
  }, [insertImageFile]);
  const uploadImageFiles = useCallback((files) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    images.forEach((f) => void insertImageFile(f));
    return images.length > 0;
  }, [insertImageFile]);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Image,
      Placeholder.configure({ placeholder: placeholder ?? "Describe it \u2014 paste screenshots inline." })
    ],
    content: "",
    editorProps: {
      attributes: { class: "mvui-fb-prose" },
      handlePaste: (_view, event) => {
        if (uploadImageItems(event.clipboardData?.items)) return true;
        const files = event.clipboardData?.files;
        if (files && files.length && uploadImageFiles(Array.from(files))) return true;
        return false;
      },
      handleDrop: (_view, event) => {
        const dt = event.dataTransfer;
        if (!dt?.files?.length) return false;
        const handled = uploadImageFiles(Array.from(dt.files));
        if (handled) event.preventDefault();
        return handled;
      }
    },
    onUpdate: ({ editor: editor2 }) => onChange(editor2.getHTML(), editor2.isEmpty)
  });
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);
  return /* @__PURE__ */ jsxs("div", { children: [
    /* @__PURE__ */ jsx("div", { className: "mvui-fb-composer", children: /* @__PURE__ */ jsx(EditorContent, { editor }) }),
    /* @__PURE__ */ jsxs("div", { className: "mvui-fb-composer-tools", children: [
      /* @__PURE__ */ jsx("button", { type: "button", className: "mvui-fb-link", onClick: () => fileInputRef.current?.click(), children: "+ Add screenshot" }),
      uploading > 0 ? /* @__PURE__ */ jsx("span", { className: "mvui-fb-hint", children: "Uploading screenshot\u2026" }) : /* @__PURE__ */ jsx("span", { className: "mvui-fb-hint", children: "or paste an image" }),
      /* @__PURE__ */ jsx(
        "input",
        {
          ref: fileInputRef,
          type: "file",
          accept: "image/*",
          multiple: true,
          style: { display: "none" },
          onChange: (e) => {
            if (e.target.files) uploadImageFiles(Array.from(e.target.files));
            e.target.value = "";
          }
        }
      )
    ] }),
    uploadError && /* @__PURE__ */ jsx("p", { className: "mvui-fb-err", children: uploadError })
  ] });
}
var feedback_composer_default = FeedbackComposer;
export {
  FeedbackComposer,
  feedback_composer_default as default
};
