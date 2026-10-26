// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { expect, it, vi } from 'vitest';
import { DescriptionEditor } from './DescriptionEditor';

const useEditor = vi.hoisted(() => vi.fn<() => Editor | null>());
vi.mock('@tiptap/react', async (importOriginal) => ({
  ...await importOriginal<typeof import('@tiptap/react')>(),
  useEditor,
}));

it('does not read content or commands from an editor disposed before effects reconnect', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const disposed = new Editor({ extensions: [StarterKit], content: '<p>Previous instance</p>' });
  disposed.destroy();
  const readHtml = vi.spyOn(disposed, 'getHTML');
  useEditor.mockReturnValue(disposed);
  const changed = vi.fn();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(
      <DescriptionEditor value="Original" gallery={[]} onChange={changed}
        onGalleryChange={vi.fn()} onBusyChange={vi.fn()} />,
    ));
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Loading description editor…');
    expect(readHtml).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
