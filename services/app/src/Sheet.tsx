// The app's one sheet (Seb, 2026-10-30: a rule for the whole app). On a
// phone it slides up from the bottom over the tab bar, as high as what is
// in it and at most 85% of the screen, with the page behind dimmed and
// blurred. A tap on that page, Escape or the sheet's own Abbrechen or
// Schließen is one exit (standards/frontend/screen-states.md). Wider,
// "inline" stays where it was opened (a day in its row) and "float" is a
// card at the bottom over the same dimmed page.
import { useEffect, type ReactNode } from "react";

const phone =
  "max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-40 max-md:max-h-[85dvh] max-md:overflow-y-auto max-md:rounded-t-2xl max-md:border-t max-md:border-line max-md:bg-card max-md:px-4 max-md:pt-2 max-md:pb-[calc(1rem+env(safe-area-inset-bottom))] max-md:shadow-2xl max-md:motion-safe:animate-sheet-up";
const wider = {
  inline: "md:px-4 md:py-3",
  float:
    "md:fixed md:inset-x-0 md:bottom-4 md:z-40 md:mx-auto md:max-h-[70vh] md:max-w-3xl md:overflow-y-auto md:rounded-2xl md:border md:border-line md:bg-card md:px-4 md:pt-3 md:pb-4 md:shadow-2xl md:motion-safe:animate-sheet-up",
};

export function Sheet({
  label,
  wide,
  onClose,
  children,
}: {
  label: string;
  wide: keyof typeof wider;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-black/40 backdrop-blur-sm motion-safe:animate-fade-in ${wide === "inline" ? "md:hidden" : ""}`}
        aria-hidden="true"
        data-backdrop
        onClick={onClose}
      />
      <div role="dialog" aria-label={label} className={`${phone} ${wider[wide]}`}>
        <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-line md:hidden" aria-hidden="true" />
        {children}
      </div>
    </>
  );
}
