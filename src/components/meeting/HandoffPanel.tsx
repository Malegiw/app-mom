import { useMemo, useState } from "react";
import { Check, ClipboardCopy, ClipboardPaste, ExternalLink } from "lucide-react";
import { Alert } from "@/components/arc/alert/alert";
import { Button } from "@/components/arc/button/button";
import { Textarea } from "@/components/arc/textarea/textarea";
import { updateMeeting } from "@/lib/db";
import { buildHandoffPrompt, HandoffError, parseHandoffReply } from "@/lib/handoff";
import { toMinutes } from "@/lib/minutesPrompt";
import { getSettings } from "@/lib/settings";
import type { Meeting } from "@/lib/types";
import { mergeAttendees } from "./useMinutesGenerator";

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

  async function apply() {
    setError(null);
    setSaving(true);
    try {
      const result = parseHandoffReply(reply);
      const title = result.title.trim();
      await updateMeeting(meeting.id, {
        minutes: toMinutes(result, "claude.ai"),
        attendees: mergeAttendees(meeting.attendees, result.attendees),
        ...(meeting.title === PLACEHOLDER_TITLE && title ? { title } : {}),
      });
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
          <strong>Salin prompt.</strong> Isinya petunjuk, data rapat, dan transkrip.
        </li>
        <li>
          <strong>Tempel di claude.ai</strong> pada percakapan baru, lalu kirim.
        </li>
        <li>
          <strong>Salin jawaban Claude</strong> dan tempel di kolom bawah.
        </li>
      </ol>

      <div className="row">
        <Button className="tone-blue" onClick={() => void copyPrompt()} disabled={!ready}>
          {copied ? <Check {...ICON} /> : <ClipboardCopy {...ICON} />}
          {copied ? "Tersalin" : "Salin prompt"}
        </Button>
        <a className="linkButton" href="https://claude.ai/new" target="_blank" rel="noreferrer">
          <ExternalLink size={16} strokeWidth={1.75} aria-hidden="true" /> Buka claude.ai
        </a>
      </div>

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

      <div className="row">
        <Button className="tone-blue" onClick={() => void apply()} disabled={!reply.trim() || saving}>
          <ClipboardPaste {...ICON} />
          Buat notulen dari jawaban
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Batal
        </Button>
      </div>
    </div>
  );
}
