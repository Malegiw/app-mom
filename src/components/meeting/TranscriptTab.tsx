import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Check, Pencil, Plus, Trash2, UserPen, X } from "lucide-react";
import { Alert } from "@/components/arc/alert/alert";
import { Button } from "@/components/arc/button/button";
import { ConfirmMorph } from "@/components/arc/confirm-morph/confirm-morph";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { Input } from "@/components/arc/input/input";
import { deleteAsset, listAssets, replaceSourceSegments, updateMeeting } from "@/lib/db";
import { engineTranscribe, useEngine } from "@/lib/engine";
import { formatClock, formatDuration } from "@/lib/format";
import { useSettings } from "@/lib/settings";
import { transcribeAudio } from "@/lib/stt";
import { fromTimedText, uniqueSpeakers, wordCount } from "@/lib/transcript";
import type { Asset, Meeting, Segment } from "@/lib/types";
import { CapturePanel } from "./CapturePanel";
import type { Recorder } from "./useRecorder";

export function TranscriptTab({ meeting, recorder }: { meeting: Meeting; recorder: Recorder }) {
  const audios = useLiveQuery(() => listAssets(meeting.id, "audio"), [meeting.id]) ?? [];
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const hasText = meeting.segments.length > 0;
  const showCapture = !hasText || adding || recorder.status !== "idle";
  const speakers = useMemo(() => uniqueSpeakers(meeting.segments), [meeting.segments]);

  async function saveSegment(id: string, patch: Pick<Segment, "speaker" | "text">) {
    await updateMeeting(meeting.id, { segments: meeting.segments.map((segment) => (segment.id === id ? { ...segment, ...patch } : segment)) });
  }
  async function removeSegment(id: string) {
    await updateMeeting(meeting.id, { segments: meeting.segments.filter((segment) => segment.id !== id) });
  }

  return (
    <div className="stack loose">
      {showCapture ? (
        <section className="panel stack" aria-labelledby="tambah-transkrip">
          <div className="sectionHead">
            <div>
              <h2 id="tambah-transkrip" className="sectionTitle">
                {hasText ? "Tambah transkrip" : "Mulai dari transkrip"}
              </h2>
              {!hasText ? <p className="muted small">Rekam rapat sekarang, impor transkrip dari Teams atau Zoom, atau tempel catatan Anda.</p> : null}
            </div>
            {hasText && recorder.status === "idle" ? (
              <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
                Tutup
              </Button>
            ) : null}
          </div>
          <CapturePanel meeting={meeting} recorder={recorder} />
        </section>
      ) : null}

      {audios.length > 0 ? (
        <section className="stack" aria-labelledby="rekaman">
          <h2 id="rekaman" className="sectionTitle">
            Rekaman audio
          </h2>
          <div className="group">
            {audios.map((audio) => (
              <AudioRow key={audio.id} audio={audio} meeting={meeting} />
            ))}
          </div>
        </section>
      ) : null}

      {hasText ? (
        <section className="stack" aria-labelledby="isi-transkrip">
          <div className="sectionHead">
            <div>
              <h2 id="isi-transkrip" className="sectionTitle">
                Transkrip
              </h2>
              <p className="muted small">
                {wordCount(meeting.segments).toLocaleString("id-ID")} kata
                {meeting.durationSec > 0 ? `, ${formatDuration(meeting.durationSec).toLowerCase()}` : ""}
                {speakers.length > 0 ? `, ${speakers.length} pembicara` : ""}
              </p>
            </div>
            <div className="row">
              {!showCapture ? (
                <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
                  <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
                  Tambah
                </Button>
              ) : null}
              {speakers.length > 0 ? (
                <Button variant="secondary" size="sm" onClick={() => setRenaming(true)}>
                  <UserPen size={16} strokeWidth={1.75} aria-hidden="true" />
                  Ganti nama pembicara
                </Button>
              ) : null}
              <ConfirmMorph
                label="Hapus transkrip"
                prompt="Hapus seluruh transkrip?"
                confirmLabel="Hapus"
                onConfirm={() => updateMeeting(meeting.id, { segments: [] })}
              />
            </div>
          </div>
          <div className="group">
            {meeting.segments.map((segment) => (
              <SegmentRow key={segment.id} segment={segment} onSave={saveSegment} onRemove={removeSegment} />
            ))}
          </div>
        </section>
      ) : null}

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent title="Ganti nama pembicara" description="Nama baru berlaku untuk semua ucapan pembicara itu.">
          <RenameSpeakers meeting={meeting} speakers={speakers} onDone={() => setRenaming(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SegmentRow({
  segment,
  onSave,
  onRemove,
}: {
  segment: Segment;
  onSave: (id: string, patch: Pick<Segment, "speaker" | "text">) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [speaker, setSpeaker] = useState(segment.speaker);
  const [text, setText] = useState(segment.text);

  function open() {
    setSpeaker(segment.speaker);
    setText(segment.text);
    setEditing(true);
  }

  if (editing) {
    return (
      <div className="segment">
        <span className="segTime">{segment.start !== null ? formatClock(segment.start) : ""}</span>
        <div className="segEdit">
          <input className="bareInput" aria-label="Nama pembicara" placeholder="Nama pembicara" value={speaker} onChange={(event) => setSpeaker(event.target.value)} />
          <textarea className="bareTextarea" aria-label="Ucapan" rows={4} value={text} onChange={(event) => setText(event.target.value)} />
          <div className="row">
            <Button
              size="sm"
              className="tone-blue"
              onClick={async () => {
                await onSave(segment.id, { speaker: speaker.trim(), text: text.trim() });
                setEditing(false);
              }}
              disabled={!text.trim()}
            >
              <Check size={16} strokeWidth={2} aria-hidden="true" />
              Simpan
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Batal
            </Button>
          </div>
        </div>
        <button type="button" className="iconButton danger" onClick={() => void onRemove(segment.id)} aria-label="Hapus bagian ini">
          <Trash2 size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div className="segment">
      <span className="segTime">{segment.start !== null ? formatClock(segment.start) : ""}</span>
      <p className="segText">
        {segment.speaker ? <span className="segSpeaker">{segment.speaker}: </span> : null}
        {segment.text}
      </p>
      <button type="button" className="iconButton" onClick={open} aria-label="Ubah bagian ini">
        <Pencil size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );
}

function RenameSpeakers({ meeting, speakers, onDone }: { meeting: Meeting; speakers: string[]; onDone: () => void }) {
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(speakers.map((name) => [name, name])));

  async function save() {
    const map = new Map(Object.entries(names).map(([from, to]) => [from, to.trim() || from]));
    await updateMeeting(meeting.id, {
      segments: meeting.segments.map((segment) => (map.has(segment.speaker.trim()) ? { ...segment, speaker: map.get(segment.speaker.trim())! } : segment)),
    });
    onDone();
  }

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {speakers.map((name) => (
        <Input key={name} label={name} value={names[name] ?? name} onChange={(event) => setNames((current) => ({ ...current, [name]: event.target.value }))} />
      ))}
      <div className="formActions">
        <Button type="button" variant="ghost" onClick={onDone}>
          Batal
        </Button>
        <Button type="submit" className="tone-blue">
          Simpan nama
        </Button>
      </div>
    </form>
  );
}

function AudioRow({ audio, meeting }: { audio: Asset; meeting: Meeting }) {
  const settings = useSettings();
  const engine = useEngine();
  const viaEngine = engine.state === "ready" && engine.whisper;
  const [url, setUrl] = useState("");
  const [working, setWorking] = useState(false);
  const [percent, setPercent] = useState(0);
  const [message, setMessage] = useState<{ tone: "danger" | "success"; text: string } | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(audio.blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [audio.blob]);

  async function transcribe() {
    setWorking(true);
    setPercent(0);
    setMessage(null);
    try {
      const offset = audio.offsetSec ?? 0;
      let segments;
      let durationSec;
      if (viaEngine) {
        // Whisper on the engine's computer: free and private, without speaker labels.
        const result = await engineTranscribe(audio.blob, { language: meeting.language, onProgress: (progress) => setPercent(progress.stage === "transcribe" ? progress.percent : 0) });
        segments = fromTimedText(result.segments, offset);
        durationSec = result.durationSec;
      } else {
        const result = await transcribeAudio(audio.blob, { apiKey: settings.elevenLabsKey, language: meeting.language, fileName: audio.name });
        segments = result.segments.map((segment) => ({ ...segment, start: segment.start === null ? null : segment.start + offset }));
        durationSec = result.durationSec;
      }
      if (segments.length === 0) {
        setMessage({ tone: "danger", text: "Tidak ada ucapan yang terdeteksi di rekaman ini." });
        return;
      }
      await replaceSourceSegments(meeting.id, audio.sessionId ?? audio.id, segments, offset + durationSec);
      setMessage({ tone: "success", text: `${segments.length} bagian masuk ke transkrip${viaEngine ? "" : ", lengkap dengan label pembicara"}.` });
    } catch (cause) {
      setMessage({ tone: "danger", text: cause instanceof Error ? cause.message : "Transkripsi gagal." });
    } finally {
      setWorking(false);
    }
  }

  return (
    <div>
      <div className="audioRow">
        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
          <strong style={{ fontWeight: 500 }}>{audio.name}</strong>
          <p className="muted small">{(audio.blob.size / (1024 * 1024)).toFixed(1)} MB</p>
        </div>
        {url ? <audio controls preload="metadata" src={url} /> : null}
        <div className="row">
          {viaEngine || settings.elevenLabsKey ? (
            <Button variant="secondary" size="sm" onClick={() => void transcribe()} loading={working}>
              {working && percent > 0 ? `Menyalin ${percent}%` : "Transkripsikan"}
            </Button>
          ) : (
            <Link to="/pengaturan" className="small">
              Aktifkan transkripsi audio
            </Link>
          )}
          <a className="iconButton" href={url} download={audio.name} aria-label={`Unduh ${audio.name}`}>
            <DownloadIcon />
          </a>
          <button type="button" className="iconButton danger" onClick={() => void deleteAsset(audio.id)} aria-label={`Hapus ${audio.name}`}>
            <X size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      </div>
      {message ? (
        <div style={{ padding: "0 var(--space-6) var(--space-4)" }}>
          <Alert tone={message.tone} title={message.tone === "success" ? "Transkripsi selesai" : "Transkripsi gagal"} onDismiss={() => setMessage(null)}>
            {message.text}
          </Alert>
        </div>
      ) : null}
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4v11" />
      <path d="m7 11 5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  );
}
