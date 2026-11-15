import { useMemo, useState } from "react";
import { Check, ClipboardPaste, ExternalLink } from "lucide-react";
import { Alert } from "@/components/arc/alert/alert";
import { Button } from "@/components/arc/button/button";
import { Textarea } from "@/components/arc/textarea/textarea";
import { updateMeeting } from "@/lib/db";
import { buildHandoffPrompt, HandoffError, parseHandoffReply } from "@/lib/handoff";
import { toMinutes } from "@/lib/minutesPrompt";
import { getSettings } from "@/lib/settings";
import type { Meeting } from "@/lib/types";
import { mergeAttendees, saveVisuals } from "./useMinutesGenerator";

const PLACEHOLDER_TITLE = "Rapat tanpa judul";
const ICON = { size: 18, strokeWidth: 1.75, "aria-hidden": true } as const;

/**
 * Minutes through the person's own Claude subscription: copy one prompt into claude.ai, then paste
 * the reply back. No API key, no extra credit, and nothing leaves this app by itself.
 */
export function HandoffPanel({ meeting, onDone, onCancel }: { meeting: Meeting; onDone: () => void; onCancel: () => void }) {
  const [copied, setCopied] = useState(false);
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const prompt = useMemo(() => {
    try {
      return buildHandoffPrompt(meeting, getSettings().language);
    } catch (cause) {
      return cause instanceof HandoffError ? cause.message : "";
    }
  }, [meeting]);
  const ready = meeting.segments.length > 0;

  async function copyPrompt() {
    setError(null);
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Browser menolak menyalin otomatis. Pilih seluruh teks prompt di bawah, lalu salin dengan tahan atau Ctrl+C.");
    }
  }

  /** One tap: copies the prompt and opens Claude in a new tab. */
  async function copyAndOpen() {
    await copyPrompt();
    window.open("https://claude.ai/new", "_blank", "noopener");
  }

  /** One tap: reads Claude's answer from the clipboard and builds the minutes from it. */
  async function pasteAndApply() {
    setError(null);
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      setError("Browser tidak mengizinkan membaca salinan. Buka Cara manual di bawah, tempel jawaban Claude di sana, lalu tekan Buat notulen.");
      return;
    }
    setReply(text);
    await apply(text);
  }

  async function apply(raw = reply) {
    setError(null);
    setSaving(true);
    try {
      const result = parseHandoffReply(raw);
      const title = result.title.trim();
      await updateMeeting(meeting.id, {
        minutes: toMinutes(result, "claude.ai"),
        attendees: mergeAttendees(meeting.attendees, result.attendees),
        ...(meeting.title === PLACEHOLDER_TITLE && title ? { title } : {}),
      });
      await saveVisuals(meeting.id, result.visuals);
      onDone();
    } catch (cause) {
      setError(cause instanceof HandoffError ? cause.message : "Notulen gagal disimpan. Coba lagi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack">
      <div>
        <h2 className="sectionTitle">Susun notulen dengan langganan Claude</h2>
        <p className="muted">Memakai paket Claude Anda sendiri. Tanpa kunci API dan tanpa kredit tambahan.</p>
      </div>

      {error ? (
        <Alert tone="danger" title="Belum berhasil" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      <ol className="steps">
        <li>
          <strong>Salin prompt dan buka Claude.</strong> Tempel di percakapan baru, lalu kirim.
        </li>
        <li>
          <strong>Setelah Claude menjawab,</strong> ketuk Salin pada jawabannya.
        </li>
        <li>
          <strong>Kembali ke sini</strong> dan ketuk Tempel jawaban. Notulen dan gambarnya langsung dibuat.
        </li>
      </ol>

      <div className="row">
        <Button className="tone-blue" onClick={() => void copyAndOpen()} disabled={!ready}>
          {copied ? <Check {...ICON} /> : <ExternalLink {...ICON} />}
          {copied ? "Tersalin, Claude terbuka" : "Salin prompt dan buka Claude"}
        </Button>
        <Button className="tone-orange" onClick={() => void pasteAndApply()} disabled={!ready} loading={saving}>
          <ClipboardPaste {...ICON} />
          Tempel jawaban Claude
        </Button>
      </div>

      <details className="manual">
        <summary>Cara manual, jika tombol di atas tidak jalan</summary>
        <div className="stack">
      <Textarea label="Isi prompt (bisa dipilih dan disalin manual)" value={prompt} readOnly rows={5} spellCheck={false} onFocus={(event) => event.currentTarget.select()} />

      <Textarea
        label="Jawaban Claude"
        description="Tempel seluruh jawaban. Teks di sekitar JSON tidak masalah."
        value={reply}
        onChange={(event) => setReply(event.target.value)}
        rows={8}
        spellCheck={false}
        placeholder='{ "title": "...", ... }'
      />

          <Button className="tone-blue" onClick={() => void apply()} disabled={!reply.trim() || saving}>
            Buat notulen dari jawaban
          </Button>
        </div>
      </details>

      <div className="row">
        <Button variant="secondary" onClick={onCancel}>
          Batal
        </Button>
      </div>
    </div>
  );
}
