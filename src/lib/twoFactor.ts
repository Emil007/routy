import { TOTP, Secret } from "otpauth";
import QRCode from "qrcode";

const ISSUER = "Routy";
const DIGITS = 6;
const PERIOD = 30;

export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

function totp(secret: string, username: string): TOTP {
  return new TOTP({
    issuer: ISSUER,
    label: username,
    algorithm: "SHA1",
    digits: DIGITS,
    period: PERIOD,
    secret: Secret.fromBase32(secret),
  });
}

/** window: 1 tolerates the authenticator's clock being up to ~30s off either way. */
export function verifyTotpCode(secret: string, username: string, code: string): boolean {
  const cleaned = code.trim().replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;
  return totp(secret, username).validate({ token: cleaned, window: 1 }) !== null;
}

/** A scannable QR code (data: URL) encoding the otpauth:// URI — nothing leaves the server. */
export function totpQrCodeDataUrl(secret: string, username: string): Promise<string> {
  return QRCode.toDataURL(totp(secret, username).toString(), { margin: 1, width: 220 });
}
