import { ImageResponse } from "next/og";

// ApplyDeck favicon — matches components/co-mark.tsx one-for-one: serif "A"
// on the brand-orange front card, darker card peeking out behind (the deck).
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
        }}
      >
        {/* back card of the deck */}
        <div
          style={{
            position: "absolute",
            left: 5,
            top: 5,
            width: 26,
            height: 26,
            borderRadius: 6,
            background: "hsl(26, 60%, 38%)",
          }}
        />
        {/* front card */}
        <div
          style={{
            position: "absolute",
            left: 1,
            top: 1,
            width: 26,
            height: 26,
            borderRadius: 6,
            background: "hsl(26, 73%, 51%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: 19,
            fontFamily: "Georgia, 'Times New Roman', serif",
            paddingBottom: 2,
          }}
        >
          A
        </div>
      </div>
    ),
    { ...size },
  );
}
