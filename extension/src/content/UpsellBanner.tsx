interface UpsellBannerProps {
  message: string;
  onDismiss: () => void;
}

export function UpsellBanner({ message, onDismiss }: UpsellBannerProps) {
  return (
    <div
      data-notemark-ui
      style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 2147483647 }}
      className="nm-toolbar max-w-[360px]"
    >
      <div className="flex items-start gap-3 rounded-lg bg-ink px-4 py-3 shadow-toolbar">
        <span className="mt-0.5 text-base">✨</span>
        <p className="flex-1 text-xs leading-snug text-white/90">{message}</p>
        <button
          onClick={onDismiss}
          className="rounded px-1 text-xs text-white/60 hover:bg-white/10 hover:text-white/90"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
