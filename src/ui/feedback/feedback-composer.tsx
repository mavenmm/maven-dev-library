import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { useCallback, useRef, useEffect, useState } from "react";

// Portable rich-text body for the feedback widget. Uses TipTap's OFFICIAL Image
// extension (no app-local node): pasted/picked screenshots are uploaded via the
// injected `uploadImage` transport, which returns a PERMANENT public URL that is
// inserted as the <img src> directly — so editor.getHTML() is the Teamwork
// comment body verbatim and renders inline forever (no presigned-URL expiry).

interface Props {
  uploadImage: (file: File | Blob) => Promise<{ url: string }>;
  onChange: (html: string, isEmpty: boolean) => void;
  placeholder?: string;
}

export function FeedbackComposer({ uploadImage, onChange, placeholder }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const insertImageFile = useCallback(async (file: File | Blob): Promise<void> => {
    const editor = editorRef.current;
    if (!editor) return;
    setUploadError(null);
    setUploading((n) => n + 1);
    try {
      const { url } = await uploadImage(file);
      editor.chain().focus().setImage({ src: url }).run();
    } catch (err) {
      setUploadError(`Couldn't add screenshot: ${(err as Error).message || "upload failed"}`);
    } finally {
      setUploading((n) => Math.max(0, n - 1));
    }
  }, [uploadImage]);

  const uploadImageItems = useCallback((items?: DataTransferItemList | null): boolean => {
    if (!items) return false;
    let found = false;
    for (const item of Array.from(items)) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) { found = true; void insertImageFile(file); }
      }
    }
    return found;
  }, [insertImageFile]);

  const uploadImageFiles = useCallback((files: File[]): boolean => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    images.forEach((f) => void insertImageFile(f));
    return images.length > 0;
  }, [insertImageFile]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Image,
      Placeholder.configure({ placeholder: placeholder ?? "Describe it — paste screenshots inline." }),
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
        const dt = (event as DragEvent).dataTransfer;
        if (!dt?.files?.length) return false;
        const handled = uploadImageFiles(Array.from(dt.files));
        if (handled) event.preventDefault();
        return handled;
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML(), editor.isEmpty),
  });

  useEffect(() => { editorRef.current = editor; }, [editor]);

  return (
    <div>
      <div className="mvui-fb-composer">
        <EditorContent editor={editor} />
      </div>
      <div className="mvui-fb-composer-tools">
        <button type="button" className="mvui-fb-link" onClick={() => fileInputRef.current?.click()}>+ Add screenshot</button>
        {uploading > 0 ? <span className="mvui-fb-hint">Uploading screenshot…</span> : <span className="mvui-fb-hint">or paste an image</span>}
        <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: "none" }}
          onChange={(e) => { if (e.target.files) uploadImageFiles(Array.from(e.target.files)); e.target.value = ""; }} />
      </div>
      {uploadError && <p className="mvui-fb-err">{uploadError}</p>}
    </div>
  );
}

export default FeedbackComposer;
