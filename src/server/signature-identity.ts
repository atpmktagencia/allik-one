import "@tanstack/react-start/server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

function key() {
  const secret = process.env["DOCUMENT_SIGNATURE_SECRET"];
  if (!secret || secret.length < 32) throw new Error("SIGNATURE_SECRET_MISSING");
  return createHash("sha256").update(`allik-signing-identity:${secret}`).digest();
}
export function signatureSecretReady() {
  return Boolean(
    process.env["DOCUMENT_SIGNATURE_SECRET"] &&
    process.env["DOCUMENT_SIGNATURE_SECRET"]!.length >= 32,
  );
}
export function normalizeSignerCpf(value: string) {
  const cpf = value.replace(/\D/g, "");
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) throw new Error("CPF_INVALID");
  for (let i = 9; i < 11; i++) {
    const sum = [...cpf.slice(0, i)].reduce(
      (acc, digit, index) => acc + Number(digit) * (i + 1 - index),
      0,
    );
    const check = (sum * 10) % 11;
    if (Number(cpf[i]) !== (check === 10 ? 0 : check)) throw new Error("CPF_INVALID");
  }
  return cpf;
}
export function encryptSignerCpf(cpf: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(normalizeSignerCpf(cpf), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}
export function decryptSignerCpf(value: string) {
  const [iv, tag, ciphertext, extra] = value.split(".");
  if (!iv || !tag || !ciphertext || extra) throw new Error("IDENTITY_UNAVAILABLE");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return normalizeSignerCpf(
    Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8"),
  );
}
export function signerCpfHash(cpf: string) {
  return createHmac("sha256", key()).update(normalizeSignerCpf(cpf)).digest("hex");
}
export const signatureHash = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
