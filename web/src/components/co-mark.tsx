import { instrumentSerif } from "@/lib/fonts";

// ApplyDeck brand mark — serif "A" on a brand-orange card, with a second card
// offset behind it: a literal "deck" of applications. Matches the favicon
// (src/app/icon.tsx) one-for-one. Rendered with the app's existing design
// tokens (Instrument Serif + --color-brand) so the mark reads native.
export function CoMark({ size = 28 }: { size?: number }) {
  const offset = Math.max(2, Math.round(size * 0.09));
  return (
    <span
      aria-hidden="true"
      className={`${instrumentSerif.className} inline-flex shrink-0 items-center justify-center rounded-md bg-brand text-white`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.72),
        letterSpacing: "0.01em",
        lineHeight: 1,
        paddingBottom: Math.round(size * 0.06),
        // The "deck": a second card peeking out behind the front card.
        boxShadow: `${offset}px ${offset}px 0 0 hsl(26 60% 38%)`,
        marginRight: offset,
        marginBottom: offset,
      }}
    >
      A
    </span>
  );
}
