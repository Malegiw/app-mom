import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Mic, Pause, Play, Square } from "lucide-react";
import { Alert } from "@/components/arc/alert/alert";
import { Button } from "@/components/arc/button/button";
import { FileDropzone, type FileDropzoneUpload } from "@/components/arc/file-dropzone/file-dropzone";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { Select } from "@/components/arc/select/select";
import { Switch } from "@/components/arc/switch/switch";
import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import { Textarea } from "@/components/arc/textarea/textarea";
import { addAsset, appendSegments, replaceSourceSegments } from "@/lib/db";
import { formatClock } from "@/lib/format";
import { canCaptureOnlineAudio, canRecord, type AudioSource } from "@/lib/recorder";
import { getSettings, useSettings } from "@/lib/settings";
import { speechSupported } from "@/lib/speech";
import { transcribeAudio } from "@/lib/stt";
import { docxToText, lastTimestamp, parseTranscript } from "@/lib/transcript";
import type { Meeting } from "@/lib/types";
import type { Recorder } from "./useRecorder";

type Mode = "record" | "import" | "paste";

const MODES = [
  { value: "record", label: "Rekam" },
  { value: "import", label: "Impor berkas" },
  { value: "paste", label: "Tempel teks" },
];

const IMPORT_ACCEPT = ".vtt,.srt,.txt,.docx,audio/*,video/*,.mp3,.m4a,.wav,.mp4,.webm,.ogg";

/** Three ways to get words into the transcript: record now, import a file, or paste text. */
export function CapturePanel({ meeting, recorder }: { meeting: Meeting; recorder: Recorder }) {
  const [mode, setMode] = useState<Mode>("record");
  const busy = recorder.status !== "idle";

  return (
    <div className="capture">
      <SegmentedControl label="Cara menambah transkrip" options={MODES} value={busy ? "record" : mode} onValueChange={(value) => !busy && setMode(value as Mode)} fullWidth />
      {busy || mode === "record" ? <RecordMode meeting={meeting} recorder={recorder} /> : mode === "import" ? <ImportMode meeting={meeting} /> : <PasteMode meeting={meeting} />}
    </div>
  );
}

function RecordMode({ meeting, recorder }: { meeting: Meeting; recorder: Recorder }) {
  const onlineAvailable = canCaptureOnlineAudio();
  const captionsAvailable = speechSupported();
  const [source, setSource] = useState<AudioSource>(meeting.platform !== "offline" && onlineAvailable ? "online" : "mic");
  const [live, setLive] = useState(captionsAvailable);
  const idle = recorder.status === "idle";
  const recording = recorder.status === "recording";

  if (!canRecord()) {
    return (
      <Alert tone="warning" title="Perekaman belum didukung di browser ini">
        Buka Notula di Chrome, Edge, atau Safari versi terbaru. Anda tetap bisa mengimpor berkas atau menempel teks.
      </Alert>
    );
  }

  const sourceOptions = [
    { value: "mic", label: "Mikrofon perangkat ini" },
    ...(onlineAvailable ? [{ value: "online", label: "Audio rapat online dan mikrofon" }] : []),
  ];

  return (
    <div className="stack">
      {recorder.error ? (
        <Alert tone="danger" title="Perekaman tidak bisa dimulai">
          {recorder.error}
        </Alert>
      ) : null}
      {recorder.notice ? (
        <Alert tone="warning" title="Transkrip langsung terhenti">
          {recorder.notice}
        </Alert>
      ) : null}

      <div className="recorder">
        {idle || recorder.status === "starting" ? (
          <>
            <button
              type="button"
              className="recordButton"
              disabled={recorder.status === "starting"}
              onClick={() => void recorder.start({ source, live: live && captionsAvailable })}
              aria-label="Mulai merekam"
            >
              <Mic size={34} strokeWidth={2} aria-hidden="true" />
            </button>
            {recorder.status === "starting" ? (
              <TextShimmer>Menunggu izin mikrofon</TextShimmer>
            ) : (
              <p className="muted">
                {source === "online"
                  ? "Ketuk untuk mulai. Pilih tab atau jendela rapat, lalu centang berbagi audio."
                  : "Ketuk untuk mulai merekam. Letakkan perangkat dekat para pembicara."}
              </p>
            )}
          </>
        ) : (
          <>
            <div className="bigTimer" role="timer" aria-label="Lama rekaman">
              {formatClock(recorder.elapsed)}
            </div>
            <LevelMeter recorder={recorder} />
            <p className="interim" aria-live="off">
              {recorder.status === "paused"
                ? "Rekaman dijeda."
                : recorder.status === "saving"
                  ? "Menyimpan rekaman."
                  : recorder.interim || (recorder.liveCaptions ? "Mendengarkan." : "Merekam audio.")}
            </p>
            <div className="row" style={{ justifyContent: "center" }}>
              {recording ? (
                <Button variant="secondary" onClick={recorder.pause}>
                  <Pause size={18} strokeWidth={1.75} aria-hidden="true" />
                  Jeda
                </Button>
              ) : (
                <Button variant="secondary" onClick={recorder.resume} disabled={recorder.status !== "paused"}>
                  <Play size={18} strokeWidth={1.75} aria-hidden="true" />
                  Lanjutkan
                </Button>
              )}
              <Button className="tone-orange" onClick={() => void recorder.stop()} loading={recorder.status === "saving"}>
                <Square size={16} strokeWidth={2} aria-hidden="true" />
                Selesai merekam
              </Button>
            </div>
          </>
        )}
      </div>

      {idle ? (
        <div className="group">
          <div className="optionRow">
            <div className="grow">
              <Select
                label="Sumber suara"
                description={
                  onlineAvailable
                    ? "Untuk Teams, Zoom, atau Meet di komputer, pilih audio rapat online agar suara peserta lain ikut terekam."
                    : "Di ponsel dan tablet, Notula merekam lewat mikrofon. Untuk rapat online, nyalakan pengeras suara."
                }
                options={sourceOptions}
                value={source}
                onValueChange={(value) => setSource(value as AudioSource)}
              />
            </div>
          </div>
          <div className="optionRow">
            <div className="optionText">
              <strong id="opt-live">Transkrip langsung</strong>
              <p>
                {captionsAvailable
                  ? "Ucapan yang tertangkap mikrofon langsung menjadi teks selama rapat. Gratis, memakai layanan suara bawaan browser."
                  : "Browser ini tidak punya transkripsi bawaan. Rekaman tetap tersimpan dan bisa ditranskripsikan setelah rapat."}
              </p>
            </div>
            <Switch aria-labelledby="opt-live" checked={live && captionsAvailable} onCheckedChange={setLive} disabled={!captionsAvailable} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** A row of bars that follows the input level, so it is obvious the microphone is picking up sound. */
function LevelMeter({ recorder }: { recorder: Recorder }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bars = Array.from(host.current?.children ?? []) as HTMLElement[];
    const history = new Array<number>(bars.length).fill(0);
    let frame = 0;
    let tick = 0;
    const draw = () => {
      tick += 1;
      if (tick % 4 === 0) {
        history.push(recorder.level());
        history.shift();
        bars.forEach((bar, index) => {
          bar.style.height = `${4 + Math.round(history[index] * 24)}px`;
        });
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [recorder]);
  return (
    <div className="meter" ref={host} aria-hidden="true">
      {Array.from({ length: 24 }, (_, index) => (
        <i key={index} style={{ height: 4 }} />
      ))}
    </div>
  );
}

function ImportMode({ meeting }: { meeting: Meeting }) {
  const settings = useSettings();

  const upload: FileDropzoneUpload = async (item, { onProgress, signal }) => {
    const file = item.file;
    if (!file) throw new Error("Berkas tidak terbaca.");
    const name = file.name.toLowerCase();
    onProgress(10);

    if (/\.(vtt|srt|txt|md)$/.test(name) || file.type.startsWith("text/")) {
      const segments = parseTranscript(await file.text());
      if (segments.length === 0) throw new Error("Berkas ini tidak berisi teks yang bisa dibaca.");
      await appendSegments(meeting.id, segments, lastTimestamp(segments));
      onProgress(100);
      return;
    }

    if (name.endsWith(".docx")) {
      const segments = parseTranscript(await docxToText(await file.arrayBuffer()), { nameOnOwnLine: true });
      if (segments.length === 0) throw new Error("Dokumen ini tidak berisi teks yang bisa dibaca.");
      await appendSegments(meeting.id, segments, lastTimestamp(segments));
      onProgress(100);
      return;
    }

    if (file.type.startsWith("audio/") || file.type.startsWith("video/") || /\.(mp3|m4a|wav|mp4|webm|ogg|mov|aac|flac)$/.test(name)) {
      const apiKey = getSettings().elevenLabsKey;
      if (!apiKey) throw new Error("Isi kunci API ElevenLabs di Pengaturan untuk mentranskripsikan audio.");
      const result = await transcribeAudio(file, { apiKey, language: meeting.language, fileName: file.name, signal });
      onProgress(80);
      if (result.segments.length === 0) throw new Error("Tidak ada ucapan yang terdeteksi di berkas ini.");
      const asset = await addAsset({ meetingId: meeting.id, kind: "audio", name: file.name, mime: file.type || "audio/mpeg", blob: file, caption: "", width: 0, height: 0, offsetSec: 0 });
      await replaceSourceSegments(meeting.id, asset.id, result.segments, result.durationSec);
      onProgress(100);
      return;
    }

    throw new Error("Jenis berkas ini belum didukung.");
  };

  return (
    <div className="stack">
      <FileDropzone
        accept={IMPORT_ACCEPT}
        maxFiles={5}
        label="Impor transkrip atau rekaman"
        description="Letakkan berkas di sini atau pilih dari perangkat"
        note="Transkrip Teams, Zoom, atau Meet (.vtt, .docx, .srt, .txt), atau rekaman audio dan video"
        onUpload={upload}
      />
      {!settings.elevenLabsKey ? (
        <p className="muted small">
          Transkrip dari Teams, Zoom, dan Meet langsung bisa diimpor. Untuk mengubah rekaman audio atau video menjadi teks, isi kunci API ElevenLabs di <Link to="/pengaturan">Pengaturan</Link>.
        </p>
      ) : null}
    </div>
  );
}

function PasteMode({ meeting }: { meeting: Meeting }) {
  const [text, setText] = useState("");
  const [added, setAdded] = useState(0);

  async function add() {
    const segments = parseTranscript(text);
    if (segments.length === 0) return;
    await appendSegments(meeting.id, segments, lastTimestamp(segments));
    setAdded(segments.length);
    setText("");
  }

  return (
    <div className="stack">
      <Textarea
        label="Teks transkrip atau catatan rapat"
        description='Satu ucapan per baris. Awali dengan nama pembicara bila ada, misalnya "Rina: kita mulai rapatnya".'
        rows={8}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setAdded(0);
        }}
      />
      <div className="formActions">
        {added > 0 ? <span className="muted small" role="status">{added} bagian ditambahkan ke transkrip.</span> : null}
        <Button className="tone-blue" onClick={() => void add()} disabled={!text.trim()}>
          Tambahkan ke transkrip
        </Button>
      </div>
    </div>
  );
}
