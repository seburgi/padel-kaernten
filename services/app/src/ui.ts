// The app's controls, drawn with the platform's tokens only
// (standards/frontend/look.md, screen-states.md): one primary button per
// screen, quiet ones beside it, 44 px on touch.
export const primary =
  "inline-flex h-11 items-center justify-center rounded-xl bg-accent px-4 text-[15px] font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-60 pointer-coarse:h-(--size-control-touch)";
export const quiet =
  "inline-flex h-11 items-center justify-center rounded-xl border border-line bg-card px-4 text-[15px] font-semibold text-ink hover:bg-hover disabled:opacity-60 pointer-coarse:h-(--size-control-touch)";
export const danger =
  "inline-flex h-11 items-center justify-center rounded-xl bg-danger px-4 text-[15px] font-semibold text-accent-ink hover:bg-danger-hover disabled:opacity-60 pointer-coarse:h-(--size-control-touch)";
export const link = "font-semibold text-accent-text hover:underline";
export const field =
  "h-11 rounded-xl border border-line bg-card px-3 text-[15px] text-ink placeholder:text-ink-faint pointer-coarse:h-(--size-control-touch) pointer-coarse:text-base";
export const card = "rounded-2xl border border-line bg-card";
export const pressed = (on: boolean) =>
  on ? "border-accent bg-accent text-accent-ink" : "border-line bg-card text-ink hover:bg-hover";
/** A card that waits for the person: an answer, an invitation. */
export const waits = "rounded-2xl border border-warning-border bg-warning-subtle";
