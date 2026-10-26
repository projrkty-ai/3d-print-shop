import { t } from '../i18n';
import { Node, mergeAttributes, type Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { resolveAssetUrl } from '../api/urls';
import { videoEmbedUrl } from '../utils/productDescription';

export function moveDescriptionVideo(editor: Editor, position: number, direction: -1 | 1): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false;
  const node = editor.state.doc.nodeAt(position);
  if (node?.type.name !== 'descriptionVideo') return false;
  const resolved = editor.state.doc.resolve(position);
  const index = resolved.index() + direction;
  if (index < 0 || index >= resolved.parent.childCount) return false;
  const sibling = resolved.parent.child(index);
  const target = position + direction * sibling.nodeSize;
  const transaction = editor.state.tr.delete(position, position + node.nodeSize).insert(target, node);
  transaction.setSelection(NodeSelection.create(transaction.doc, target)).scrollIntoView();
  editor.view.dispatch(transaction);
  return true;
}

export const DescriptionVideo = Node.create({
  name: 'descriptionVideo',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes: () => ({ src: { default: '' }, title: { default: '' } }),
  parseHTML: () => [{ tag: 'video[src]' }],
  renderHTML: ({ HTMLAttributes }) => ['video', mergeAttributes(HTMLAttributes, { controls: '', preload: 'metadata' })],
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const src = String(node.attrs.src);
      const embed = videoEmbedUrl(src);
      const dom = document.createElement('div');
      dom.className = 'description-editor__video';
      const controls = document.createElement('div');
      controls.className = 'description-editor__video-controls';
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.draggable = true;
      handle.dataset.dragHandle = '';
      handle.textContent = t("Drag to move video");
      handle.addEventListener('mousedown', () => {
        const position = getPos();
        if (typeof position === 'number' && editor.isEditable) editor.commands.setNodeSelection(position);
      });
      const up = document.createElement('button');
      const down = document.createElement('button');
      for (const [button, label, direction] of [[up, t("Move video up"), -1], [down, t("Move video down"), 1]] as const) {
        button.type = 'button';
        button.textContent = label;
        button.addEventListener('mousedown', (event) => event.preventDefault());
        button.addEventListener('click', () => {
          const position = getPos();
          if (typeof position === 'number') moveDescriptionVideo(editor, position, direction);
        });
      }
      controls.append(handle, up, down);
      dom.append(controls);
      if (embed) {
        const frame = document.createElement('iframe');
        frame.src = embed;
        frame.title = String(node.attrs.title || t("Product video"));
        frame.allowFullscreen = true;
        dom.append(frame);
      } else {
        const video = document.createElement('video');
        video.src = resolveAssetUrl(src);
        video.controls = true;
        video.preload = 'metadata';
        dom.append(video);
      }
      function refreshControls() {
        const position = getPos();
        if (typeof position !== 'number' || editor.isDestroyed) return;
        const resolved = editor.state.doc.resolve(position);
        handle.disabled = !editor.isEditable;
        up.disabled = !editor.isEditable || resolved.index() === 0;
        down.disabled = !editor.isEditable || resolved.index() === resolved.parent.childCount - 1;
      }
      refreshControls();
      editor.on('transaction', refreshControls);
      return {
        dom,
        stopEvent: (event) => event.target instanceof Element && Boolean(event.target.closest('iframe,video')),
        destroy: () => editor.off('transaction', refreshControls),
      };
    };
  },
});
