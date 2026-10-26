import { t } from '../i18n';
import { useEffect, useId, useRef, useState, type SetStateAction } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { api, ApiError } from '../api/client';
import { resolveAssetUrl } from '../api/urls';
import type { ProductMedia } from '../types';
import { editorDescription, isMediaUrl, sanitizeDescription } from '../utils/productDescription';
import { ProductMediaManager, type ManagedMedia } from './ProductMediaManager';
import { DescriptionVideo } from './descriptionVideo';

const DescriptionImage = Image.extend({
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('img');
      dom.src = resolveAssetUrl(String(node.attrs.src));
      dom.alt = String(node.attrs.alt ?? '');
      return { dom };
    };
  },
});

interface Props {
  value: string;
  format?: 'html';
  gallery: ProductMedia[];
  imageUrl?: string;
  onImageUrlChange?: (url: string) => void;
  onChange: (html: string) => void;
  onGalleryChange: (update: SetStateAction<ProductMedia[]>) => void;
  onBusyChange: (busy: boolean) => void;
  disabled?: boolean;
}

export function DescriptionEditor({ value, format, gallery, imageUrl, onImageUrlChange, onChange, onGalleryChange, onBusyChange, disabled = false }: Props) {
  const id = useId();
  const [type, setType] = useState<ProductMedia['type']>('image');
  const [destination, setDestination] = useState('description');
  const [url, setUrl] = useState('');
  const [alt, setAlt] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingMediaEdits, setPendingMediaEdits] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const uploading = useRef(false);
  const mounted = useRef(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const mediaIds = useRef(new WeakMap<object, string>());
  const nextMediaId = useRef(0);
  const editor = useEditor({
    // Suspense may discard a render before effects commit.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false } }),
      DescriptionImage.configure({ allowBase64: false }), DescriptionVideo,
    ],
    content: editorDescription({ description: value, descriptionFormat: format }),
    shouldRerenderOnTransaction: true,
    editorProps: { attributes: { role: 'textbox', 'aria-label': t("Product description"), 'aria-multiline': 'true' } },
    onUpdate: ({ editor }) => onChange(sanitizeDescription(editor.getHTML())),
  });
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; onBusyChange(false); };
  }, [onBusyChange]);
  useEffect(() => onBusyChange(busy || pendingMediaEdits), [busy, pendingMediaEdits, onBusyChange]);
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.setEditable(!disabled, false);
  }, [editor, disabled]);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const content = editorDescription({ description: value, descriptionFormat: format });
    if (sanitizeDescription(editor.getHTML()) !== content) editor.commands.setContent(content, { emitUpdate: false });
  }, [editor, value, format]);

  function insertMedia(media: ProductMedia, target = destination): boolean {
    if (!editor || editor.isDestroyed) return false;
    if (target === 'carousel') {
      onGalleryChange((previous) => [...previous, media]);
      return true;
    }
    const node = media.type === 'image'
      ? { type: 'image', attrs: { src: media.url, alt: media.alt } }
      : { type: 'descriptionVideo', attrs: { src: media.url, title: media.alt } };
    return editor.chain().focus().insertContentAt(editor.state.selection.to, [node, { type: 'paragraph' }]).run();
  }

  function addLink() {
    setError(null);
    if (!isMediaUrl(url.trim())) {
      setError(t("Enter a valid HTTP(S) media URL."));
      return;
    }
    if (destination === 'carousel' && gallery.length >= 50) {
      setError(t("The carousel can contain at most 50 additional items."));
      return;
    }
    if (!insertMedia({ type, url: url.trim(), alt: alt.trim() })) {
      setError(t("Could not insert the media. Select a position in the description and try again."));
      return;
    }
    setUrl('');
    setAlt('');
  }

  async function uploadImages(files: File[]) {
    if (files.length === 0 || uploading.current) return;
    setError(null);
    setUploadStatus('');
    const invalid = files.find((file) => !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 10 * 1024 * 1024);
    if (invalid) {
      setError(t("{0}: choose a PNG, JPEG, WebP or GIF image up to 10 MB. Videos are added by link only.", invalid.name));
      return;
    }
    if (destination === 'carousel' && gallery.length + files.length > 50) {
      setError(t("The carousel can contain at most 50 additional items."));
      return;
    }
    const target = destination;
    const label = alt.trim();
    uploading.current = true;
    setBusy(true);
    const failures: string[] = [];
    let added = 0;
    try {
      for (const [index, file] of files.entries()) {
        if (!mounted.current) return;
        setUploadStatus(t("Uploading image {0} of {1}…", index + 1, files.length));
        try {
          const result = await api.uploadDescriptionImage(file);
          if (!mounted.current) return;
          if (insertMedia({ type: 'image', url: result.url, alt: label || file.name }, target)) added++;
          else failures.push(t("{0}: uploaded to {1}, but could not be inserted. Add this URL manually.", file.name, result.url));
        } catch (error) {
          if (!mounted.current) return;
          failures.push(`${file.name}: ${error instanceof ApiError ? error.message : t("Could not upload the image. Try again.")}`);
        }
      }
      if (mounted.current) {
        setUploadStatus(t("Added {0} of {1} images.", added, files.length));
        if (failures.length > 0) setError(failures.join(' '));
      }
    } finally {
      uploading.current = false;
      if (mounted.current) {
        setBusy(false);
      }
    }
  }

  if (!editor || editor.isDestroyed) return <p role="status">{t("Loading description editor…")}</p>;
  const activeEditor = editor;
  function mediaId(value: object): string {
    let key = mediaIds.current.get(value);
    if (!key) {
      key = `${id}-media-${nextMediaId.current++}`;
      mediaIds.current.set(value, key);
    }
    return key;
  }
  const mediaItems: ManagedMedia[] = [];
  if (imageUrl && onImageUrlChange) mediaItems.push({ id: 'photo', location: 'photo', type: 'image', url: imageUrl, alt: t("Product photo") });
  for (const [index, media] of gallery.entries()) mediaItems.push({ ...media, id: mediaId(media), location: 'gallery', index });
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === 'image' || node.type.name === 'descriptionVideo') {
      const video = node.type.name === 'descriptionVideo';
      mediaItems.push({
        id: mediaId(node), location: 'description', position, type: video ? 'video' : 'image',
        url: String(node.attrs.src), alt: String(node.attrs[video ? 'title' : 'alt'] ?? ''),
      });
    }
  });

  function removeMedia(item: ManagedMedia) {
    if (item.location === 'photo') onImageUrlChange?.('');
    else if (item.location === 'gallery') onGalleryChange((previous) => previous.filter((_, index) => index !== item.index));
    else {
      const node = activeEditor.state.doc.nodeAt(item.position);
      if (node) activeEditor.commands.deleteRange({ from: item.position, to: item.position + node.nodeSize });
    }
  }

  return (
    <fieldset className="description-editor" disabled={disabled}>
      <h3 id={`${id}-label`}>{t("Description")}</h3>
      <div className="description-editor__toolbar" role="group" aria-label={t("Description formatting")}>
        <button type="button" aria-pressed={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>{t("Bold")}</button>
        <button type="button" aria-pressed={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>{t("Italic")}</button>
        <button type="button" aria-pressed={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>{t("Underline")}</button>
        <button type="button" aria-pressed={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>{t("Heading")}</button>
        <button type="button" aria-pressed={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>{t("Bullet list")}</button>
        <button type="button" aria-pressed={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>{t("Numbered list")}</button>
        <button type="button" aria-pressed={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>{t("Quote")}</button>
        <button type="button" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>{t("Undo")}</button>
        <button type="button" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>{t("Redo")}</button>
      </div>
      <EditorContent editor={editor} />
      <div className="description-editor__link">
        <label className="field"><span>{t("Text link URL")}</span><input type="url" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} /></label>
        <button type="button" className="btn btn--small btn--ghost" onClick={() => {
          if (!isMediaUrl(linkUrl.trim())) { setError(t("Enter a valid HTTP(S) link URL.")); return; }
          setError(null);
          editor.chain().focus().extendMarkRange('link').setLink({ href: linkUrl.trim() }).run();
        }}>{t("Link selected text")}</button>
        <button type="button" className="btn btn--small btn--ghost" onClick={() => editor.chain().focus().unsetLink().run()}>{t("Remove text link")}</button>
      </div>
      <fieldset className="option-group">
        <legend>{t("Add description media")}</legend>
        <p className="muted">{t("Images and videos inserted in the description also appear in the carousel. Choose carousel only to omit them from the text.")}</p>
        <div className="form-grid">
          <label className="field"><span>{t("Media type")}</span>
            <select value={type} disabled={busy} onChange={(event) => setType(event.target.value === 'video' ? 'video' : 'image')}>
              <option value="image">{t("Image")}</option><option value="video">{t("Video link")}</option>
            </select>
          </label>
          <label className="field"><span>{t("Add media to")}</span>
            <select value={destination} disabled={busy} onChange={(event) => setDestination(event.target.value)}>
              <option value="description">{t("Description and carousel")}</option><option value="carousel">{t("Carousel only")}</option>
            </select>
          </label>
          <label className="field"><span>{t("Media URL")}</span><input type="url" value={url} disabled={busy} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" /></label>
          <label className="field"><span>{t("Media description / alternative text")}</span><input value={alt} maxLength={500} disabled={busy} onChange={(event) => setAlt(event.target.value)} /></label>
        </div>
        <div className="description-editor__actions">
          <button type="button" className="btn btn--small" disabled={busy} onClick={addLink}>{t("Add media link")}</button>
          {type === 'image' && (
            <button type="button" className="btn btn--small btn--ghost" disabled={busy} onClick={() => fileInput.current?.click()}>
              {busy ? t("Uploading images…") : t("Upload image")}
            </button>
          )}
          <input ref={fileInput} type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" aria-label={t("Upload description image")} hidden
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = '';
              void uploadImages(files);
            }} />
        </div>
        <p className="muted">{t("Select one or more images: PNG/JPEG/WebP/GIF, up to 10 MB each. Videos: YouTube, Vimeo or direct MP4/WebM links; no video uploads. Uploaded images are stored immediately.")}</p>
      </fieldset>
      {uploadStatus && <p role="status">{uploadStatus}</p>}
      <ProductMediaManager items={mediaItems} disabled={busy} onPendingChange={setPendingMediaEdits}
        onRemove={removeMedia}
        onUpdate={(item, media) => {
          if (item.location === 'gallery') onGalleryChange((previous) => previous.map((entry, index) => index === item.index ? media : entry));
          else if (item.location === 'description') {
            const node = editor.state.doc.nodeAt(item.position);
            if (node) editor.view.dispatch(editor.state.tr.setNodeMarkup(item.position, undefined, {
              ...node.attrs, src: media.url, [media.type === 'image' ? 'alt' : 'title']: media.alt,
            }));
          }
        }}
        onMove={(item) => {
          setError(null);
          if (item.location === 'description') {
            if (gallery.length >= 50) { setError(t("The carousel can contain at most 50 additional items.")); return; }
            onGalleryChange((previous) => [...previous, { type: item.type, url: item.url, alt: item.alt }]);
            removeMedia(item);
          } else if (item.location === 'gallery') {
            if (insertMedia(item, 'description')) removeMedia(item);
            else setError(t("Could not insert the media. Select a position in the description and try again."));
          }
        }}
        onReorder={(item, direction) => {
          if (item.location !== 'gallery') return;
          onGalleryChange((previous) => {
            const next = [...previous];
            const index = item.index + direction;
            if (index < 0 || index >= next.length) return previous;
            [next[item.index], next[index]] = [next[index], next[item.index]];
            return next;
          });
        }}
        onLocate={(item) => {
          if (item.location === 'description') editor.chain().focus().setNodeSelection(item.position).scrollIntoView().run();
        }}
      />
      {error && <p className="banner banner--error" role="alert">{error}</p>}
    </fieldset>
  );
}
