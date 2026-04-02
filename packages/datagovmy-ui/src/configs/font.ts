import localFont from "next/font/local";

const header = localFont({
  src: "./fonts/Poppins-Bold.woff2",
  weight: "700",
  variable: "--font-header",
  display: "swap",
});

const body = localFont({
  src: "./fonts/Inter-latin.woff2",
  variable: "--font-body",
  display: "swap",
});

export { header, body };
