interface UpsellBannerProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
}

export function UpsellBanner({ message, actionLabel, onAction, onDismiss }: UpsellBannerProps) {
  return (
    <div
      data-notemark-ui
      style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 2147483647 }}
      className="nm-toolbar max-w-[360px]"
    >
      <div className="flex items-start gap-3 rounded-lg bg-ink px-4 py-3 shadow-toolbar">
        <span className="mt-0.5 text-base">✨</span>
        <div className="flex-1">
          <p className="text-xs leading-snug text-white/90">{message}</p>
          {actionLabel && onAction && (
            <button
              onClick={onAction}
              className="mt-2 rounded bg-white/15 px-2 py-1 text-xs font-medium text-white hover:bg-white/25"
            >
              {actionLabel}
            </button>
          )}
        </div>
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
