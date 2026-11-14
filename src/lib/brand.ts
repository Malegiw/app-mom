/**
 * Brand colors for places CSS variables cannot reach: canvas drawings and the Word, Excel, and
 * PowerPoint files. Keep in step with src/styles/theme.css. Values are hex without the leading "#".
 */
export const BRAND = {
  blue: "0F4C81", // PANTONE 19-4052 TCX Classic Blue
  blueStrong: "0A3961",
  blueSoft: "E7EEF5",
  orange: "FE5000", // PANTONE Orange 021 C
  orangeStrong: "C43E00",
  orangeSoft: "FFEDE5",
  white: "FFFFFF",
  brightWhite: "F4F5F0", // PANTONE 11-0601 TCX Bright White
  ink: "0B2239",
  textSecondary: "46586B",
  textMuted: "66778A",
  border: "D5DCE4",
} as const;

export const hex = (value: string) => `#${value}`;

export const APP_NAME = "Notula";
