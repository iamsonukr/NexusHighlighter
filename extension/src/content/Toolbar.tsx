import { useState } from 'react';
import { HIGHLIGHT_COLORS, type HighlightColor } from '@/types';

const COLOR_HEX: Record<HighlightColor, string> = {
  yellow: '#FFD84D',
  green: '#8FD14F',
  blue: '#6EC6FF',
  pink: '#FF8FB3',
  orange: '#FFA94D',
  purple: '#C08FFF',
};

interface ToolbarProps {
  x: number;
  y: number;
  onPick: (color: HighlightColor) => void;
  onCopy: () => void;
  onClose: () => void;
}

export function Toolbar({ x, y, onPick, onCopy, onClose }: ToolbarProps) {
  const [copied, setCopied] = useState(false);

  return (
    <div
      data-notemark-ui
      style={{
        position: 'fixed',
        left: x,
        top: y,
        transform: 'translate(-50%, -100%)',
        zIndex: 2147483647,
      }}
      className="nm-toolbar"
      onMouseDown={(e) => e.preventDefault() /* keep the text selection alive */}
    >
      <div className="flex items-center gap-1.5 rounded-lg bg-ink px-2 py-1.5 shadow-toolbar">
        {HIGHLIGHT_COLORS.map((color) => (
          <button
            key={color}
            title={`Highlight ${color}`}
            onClick={() => onPick(color)}
            className="h-6 w-6 rounded-full ring-2 ring-transparent transition hover:scale-110 hover:ring-white/40"
            style={{ backgroundColor: COLOR_HEX[color] }}
          />
        ))}
        <div className="mx-1 h-5 w-px bg-white/20" />
        <button
          title="Copy text"
          onClick={() => {
            onCopy();
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="rounded px-2 py-1 text-xs font-medium text-white/90 hover:bg-white/10"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          title="Dismiss"
          onClick={onClose}
          className="rounded px-1.5 py-1 text-xs text-white/60 hover:bg-white/10 hover:text-white/90"
        >
          ✕
        </button>
      </div>
      {/* speech-bubble tail */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          bottom: -5,
          transform: 'translateX(-50%) rotate(45deg)',
          width: 10,
          height: 10,
          background: '#1C1B1A',
        }}
      />
    </div>
  );
}
