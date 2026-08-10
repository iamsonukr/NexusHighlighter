import { useMemo, useState } from 'react';
import type { Highlight, HighlightColor } from '@/types';
import { HIGHLIGHT_COLORS } from '@/types';

const COLOR_HEX: Record<HighlightColor, string> = {
  yellow: '#FFD84D',
  green: '#8FD14F',
  blue: '#6EC6FF',
  pink: '#FF8FB3',
  orange: '#FFA94D',
  purple: '#C08FFF',
};

interface SidebarProps {
  highlights: Highlight[];
  onClose: () => void;
  onSelect: (id: string) => void;
  onRecolor: (id: string, color: HighlightColor) => void;
  onDelete: (id: string) => void;
  onSaveNote: (id: string, note: string) => void;
}

export function Sidebar({ highlights, onClose, onSelect, onRecolor, onDelete, onSaveNote }: SidebarProps) {
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return highlights;
    return highlights.filter((h) =>
      `${h.anchor.selectedText} ${h.note ?? ''} ${h.tags.join(' ')}`.toLowerCase().includes(q)
    );
  }, [highlights, query]);

  return (
    <aside
      data-notemark-ui
      className="nm-sidebar fixed right-0 top-0 z-[2147483647] flex h-full w-[340px] flex-col border-l border-rule bg-paper font-body text-ink shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-rule px-4 py-3">
        <div>
          <h2 className="font-display text-lg leading-none">Your highlights</h2>
          <p className="mt-1 text-xs text-ink-soft">{highlights.length} on this page</p>
        </div>
        <button onClick={onClose} className="rounded px-2 py-1 text-ink-soft hover:bg-accent-soft hover:text-ink">
          ✕
        </button>
      </div>

      <div className="border-b border-rule px-4 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search this page's highlights…"
          className="w-full rounded border border-rule bg-white px-3 py-1.5 text-sm outline-none focus:border-accent"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {filtered.length === 0 && (
          <div className="mt-10 text-center text-sm text-ink-soft">
            {highlights.length === 0
              ? 'Select any text on the page to start highlighting.'
              : 'No highlights match your search.'}
          </div>
        )}

        <ul className="space-y-2">
          {filtered.map((h) => (
            <li key={h.id} className="rounded-lg border border-rule bg-white p-3 shadow-card">
              <button
                onClick={() => onSelect(h.id)}
                className="block w-full text-left text-sm leading-snug"
                style={{ borderLeft: `3px solid ${COLOR_HEX[h.color]}`, paddingLeft: 8 }}
              >
                “{truncate(h.anchor.selectedText, 140)}”
              </button>

              {editingId === h.id ? (
                <div className="mt-2">
                  <textarea
                    autoFocus
                    value={draftNote}
                    onChange={(e) => setDraftNote(e.target.value)}
                    placeholder="Add a note…"
                    rows={2}
                    className="w-full rounded border border-rule px-2 py-1 text-xs outline-none focus:border-accent"
                  />
                  <div className="mt-1 flex gap-2">
                    <button
                      className="rounded bg-accent px-2 py-1 text-xs font-medium text-white"
                      onClick={() => {
                        onSaveNote(h.id, draftNote);
                        setEditingId(null);
                      }}
                    >
                      Save note
                    </button>
                    <button className="text-xs text-ink-soft" onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="mt-1.5 block text-xs text-ink-soft hover:text-ink"
                  onClick={() => {
                    setEditingId(h.id);
                    setDraftNote(h.note ?? '');
                  }}
                >
                  {h.note ? h.note : '+ Add note'}
                </button>
              )}

              <div className="mt-2 flex items-center justify-between">
                <div className="flex gap-1">
                  {HIGHLIGHT_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => onRecolor(h.id, c)}
                      title={c}
                      className="h-4 w-4 rounded-full ring-1 ring-black/10"
                      style={{
                        backgroundColor: COLOR_HEX[c],
                        outline: h.color === c ? '2px solid #1C1B1A' : 'none',
                        outlineOffset: 1,
                      }}
                    />
                  ))}
                </div>
                <button
                  onClick={() => onDelete(h.id)}
                  className="text-xs text-ink-soft hover:text-red-600"
                  title="Delete highlight"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
