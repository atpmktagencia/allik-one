import { useEffect, useRef } from "react";
import { EditorContent, useEditor, type Editor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Undo2,
  Redo2,
} from "lucide-react";
import { plainTextRichContent, type RichContentNode } from "@/lib/clinical-document-content";
import "./clinical-document-editor.css";

type Props = {
  documentId: string;
  content: string;
  richContent: RichContentNode | null;
  readonly: boolean;
  disabled?: boolean;
  title: string;
  prescription: boolean;
  focusOnMount?: boolean;
  onChange: (content: string, richContent: RichContentNode) => void;
  onReady: (editor: Editor | null) => void;
};
export function ClinicalDocumentEditor({
  documentId,
  content,
  richContent,
  readonly,
  disabled = false,
  title,
  prescription,
  focusOnMount,
  onChange,
  onReady,
}: Props) {
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          link: false,
          strike: false,
          code: false,
          codeBlock: false,
          blockquote: false,
          horizontalRule: false,
        }),
        TextAlign.configure({ types: ["heading", "paragraph"] }),
      ],
      content: (richContent ?? plainTextRichContent(content)) as JSONContent,
      editable: !readonly && !disabled,
      editorProps: {
        attributes: {
          class: "clinical-document-body",
          role: "textbox",
          "aria-label": "Conteúdo do documento",
          "aria-multiline": "true",
        },
      },
      onUpdate: ({ editor: current }) =>
        changeRef.current(
          current.getText({ blockSeparator: "\n" }),
          current.getJSON() as RichContentNode,
        ),
    },
    [documentId],
  );
  useEffect(() => {
    editor?.setEditable(!readonly && !disabled, false);
  }, [editor, readonly, disabled]);
  useEffect(() => {
    onReady(editor);
    if (editor && focusOnMount) editor.commands.focus("end");
    return () => onReady(null);
  }, [editor, onReady, focusOnMount]);
  const tools = [
    {
      label: "Negrito",
      icon: Bold,
      active: editor?.isActive("bold"),
      run: () => editor?.chain().focus().toggleBold().run(),
    },
    {
      label: "Itálico",
      icon: Italic,
      active: editor?.isActive("italic"),
      run: () => editor?.chain().focus().toggleItalic().run(),
    },
    {
      label: "Sublinhado",
      icon: Underline,
      active: editor?.isActive("underline"),
      run: () => editor?.chain().focus().toggleUnderline().run(),
    },
    {
      label: "Lista numerada",
      icon: ListOrdered,
      active: editor?.isActive("orderedList"),
      run: () => editor?.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "Lista com marcadores",
      icon: List,
      active: editor?.isActive("bulletList"),
      run: () => editor?.chain().focus().toggleBulletList().run(),
    },
    ...(["left", "center", "right"] as const).map((alignment, index) => ({
      label: ["Alinhar à esquerda", "Centralizar", "Alinhar à direita"][index],
      icon: [AlignLeft, AlignCenter, AlignRight][index]!,
      active: editor?.isActive({ textAlign: alignment }),
      run: () => editor?.chain().focus().setTextAlign(alignment).run(),
    })),
    {
      label: "Desfazer",
      icon: Undo2,
      active: false,
      run: () => editor?.chain().focus().undo().run(),
    },
    {
      label: "Refazer",
      icon: Redo2,
      active: false,
      run: () => editor?.chain().focus().redo().run(),
    },
  ];
  return (
    <div className="clinical-document-sheet">
      {!readonly && (
        <div
          className="clinical-document-formatting"
          role="toolbar"
          aria-label="Formatação do documento"
        >
          {tools.map(({ label, icon: Icon, active, run }) => (
            <button
              type="button"
              key={label}
              aria-label={label}
              title={label}
              aria-pressed={active}
              disabled={!editor || disabled}
              onClick={run}
            >
              <Icon size={18} />
            </button>
          ))}
        </div>
      )}
      <div className="clinical-document-heading">
        <h3>{title}</h3>
        {prescription && <p>Medicamentos e fórmulas</p>}
      </div>
      <EditorContent
        editor={editor}
        className={!readonly && editor?.isEmpty ? "clinical-document-empty" : undefined}
      />
    </div>
  );
}
