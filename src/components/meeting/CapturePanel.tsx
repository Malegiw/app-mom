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
import { engineTranscribe, getEngine, useEngine } from "@/lib/engine";
import { formatClock } from "@/lib/format";
import { canCaptureOnlineAudio, canRecord, type AudioSource } from "@/lib/recorder";
import { getSettings, saveSettings, useSettings } from "@/lib/settings";
import { speechSupported } from "@/lib/speech";
import { transcribeAudio } from "@/lib/stt";
import { docxToText, fromTimedText, lastTimestamp, parseTranscript } from "@/lib/transcript";
import type { Meeting } from "@/lib/types";
import { pickProvider } from "./useMinutesGenerator";
import type { LiveMode, Recorder } from "./useRecorder";

type Mode = "record" | "import" | "paste";

const MODES = [
  { value: "record", label: "Dengarkan" },
  { value: "import", label: "Impor berkas" },
  { value: "paste", label: "Tempel teks" },
];

const IMPORT_ACCEPT = ".vtt,.srt,.txt,.docx,audio/*,video/*,.mp3,.m4a,.wav,.mp4,.webm,.ogg";

/** Three ways to get words into the transcript: listen now, import a file, or paste text. */
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
  const engine = useEngine();
  const settings = useSettings();
  const sharedAudio = canCaptureOnlineAudio();
  const engineLive = engine.state === "ready" && engine.whisper;
  const [source, setSource] = useState<AudioSource>(meeting.platform !== "offline" && sharedAudio ? "online" : "mic");
  const [liveOn, setLiveOn] = useState(true);
  const idle = recorder.status === "idle";
  const recording = recorder.status === "recording";

  // The engine hears whatever is recorded. The browser's own captions hear the microphone only.
  const browserLive = speechSupported() && source !== "system";
  const liveAvailable = engineLive || browserLive;
  const live: LiveMode = !liveOn ? "off" : engineLive ? "engine" : browserLive ? "browser" : "off";
  const autoMinutes = pickProvider(engine, settings) === "engine";

  if (!canRecord()) {
    return (
      <Alert tone="warning" title="Perekaman belum didukung di browser ini">
        Buka Notula di Chrome, Edge, atau Safari versi terbaru. Anda tetap bisa mengimpor berkas atau menempel teks.
      </Alert>
    );
  }

  const sourceOptions = [
    { value: "mic", label: "Mikrofon perangkat ini" },
    ...(sharedAudio
      ? [
          { value: "online", label: "Audio komputer dan mikrofon (Teams, Zoom, Meet)" },
          { value: "system", label: "Audio komputer saja (YouTube, webinar)" },
        ]
      : []),
  ];

  const status =
    recorder.status === "paused"
      ? "Dijeda."
      : recorder.status === "saving"
        ? recorder.backlog > 0
          ? "Menyelesaikan transkrip."
          : "Menyimpan rekaman."
        : recorder.liveMode === "engine"
          ? recorder.backlog > 0
            ? "Menyalin ucapan menjadi teks."
            : "Mendengarkan."
          : recorder.liveMode === "browser"
            ? recorder.interim || "Mendengarkan."
            : "Merekam audio.";

  return (
    <div className="stack">
      {recorder.error ? (
        <Alert tone="danger" title="Belum bisa mulai mendengarkan">
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
            <button type="button" className="recordButton" disabled={recorder.status === "starting"} onClick={() => void recorder.start({ source, live })} aria-label="Mulai mendengarkan">
              <Mic size={34} strokeWidth={2} aria-hidden="true" />
            </button>
            {recorder.status === "starting" ? (
              <TextShimmer>Menunggu izin</TextShimmer>
            ) : (
              <p className="muted">
                {source === "mic"
                  ? "Ketuk untuk mulai. Letakkan perangkat dekat para pembicara."
                  : "Ketuk untuk mulai. Pilih tab (YouTube, Teams web) atau Seluruh layar (aplikasi Teams, Zoom), lalu nyalakan Bagikan audio."}
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
              {status}
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
                {autoMinutes && settings.autoMinutes ? "Selesai dan buat notulen" : "Selesai"}
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
                  sharedAudio
                    ? "Untuk rapat online atau video, pilih audio komputer agar suara dari Teams, Zoom, atau YouTube ikut terdengar."
                    : "Di ponsel dan tablet, Notula mendengar lewat mikrofon. Untuk rapat online, nyalakan pengeras suara."
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
                {engineLive
                  ? "Ucapan menjadi teks beberapa detik setelah terdengar, dikerjakan Whisper di komputer mesin. Berlaku untuk mikrofon maupun audio komputer."
                  : browserLive
                    ? source === "online"
                      ? "Memakai layanan suara bawaan browser, yang hanya mendengar mikrofon. Audio komputer tetap terekam dan bisa ditranskripsikan setelahnya."
                      : "Ucapan yang tertangkap mikrofon langsung menjadi teks, memakai layanan suara bawaan browser."
                    : "Belum tersedia di sini. Rekaman tetap tersimpan dan bisa ditranskripsikan setelah selesai."}
              </p>
            </div>
            <Switch aria-labelledby="opt-live" checked={liveOn && liveAvailable} onCheckedChange={setLiveOn} disabled={!liveAvailable} />
          </div>
          {autoMinutes ? (
            <div className="optionRow">
              <div className="optionText">
                <strong id="opt-auto">Notulen otomatis</strong>
                <p>Begitu selesai mendengarkan, Claude langsung menyusun notulen{settings.makeVisuals ? " beserta gambarnya" : ""} lewat langganan Anda.</p>
              </div>
              <Switch aria-labelledby="opt-auto" checked={settings.autoMinutes} onCheckedChange={(checked) => saveSettings({ autoMinutes: checked })} />
            </div>
          ) : null}
        </div>
      ) : null}

      {idle && engine.state !== "ready" ? (
        <p className="muted small">
          Mesin Notula belum terhubung, jadi transkrip audio komputer dan notulen otomatis belum aktif. Cara menyalakannya ada di <Link to="/pengaturan">Pengaturan</Link>.
        </p>
      ) : null}
    </div>
  );
}

/** A row of bars that follows the input level, so it is obvious that sound is coming in. */
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
  const engine = useEngine();
  const viaEngine = engine.state === "ready" && engine.whisper;

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
      let segments;
      let durationSec;
      const current = getEngine();
      if (current.state === "ready" && current.whisper) {
        const result = await engineTranscribe(file, { language: meeting.language, signal, onProgress: (progress) => onProgress(progress.stage === "transcribe" ? 15 + Math.round(progress.percent * 0.8) : 12) });
        segments = fromTimedText(result.segments);
        durationSec = result.durationSec;
      } else {
        const apiKey = getSettings().elevenLabsKey;
        if (!apiKey) throw new Error("Nyalakan mesin Notula di komputer untuk mentranskripsikan audio, atau isi kunci ElevenLabs di Pengaturan.");
        const result = await transcribeAudio(file, { apiKey, language: meeting.language, fileName: file.name, signal });
        segments = result.segments;
        durationSec = result.durationSec;
      }
      onProgress(96);
      if (segments.length === 0) throw new Error("Tidak ada ucapan yang terdeteksi di berkas ini.");
      const asset = await addAsset({ meetingId: meeting.id, kind: "audio", name: file.name, mime: file.type || "audio/mpeg", blob: file, caption: "", width: 0, height: 0, offsetSec: 0 });
      await replaceSourceSegments(meeting.id, asset.id, segments, durationSec);
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
      {viaEngine ? (
        <p className="muted small">Rekaman audio dan video ditranskripsikan oleh Whisper di komputer mesin, tanpa kunci API.</p>
      ) : !settings.elevenLabsKey ? (
        <p className="muted small">
          Transkrip dari Teams, Zoom, dan Meet langsung bisa diimpor. Untuk mengubah rekaman audio atau video menjadi teks, nyalakan mesin Notula di komputer (lihat{" "}
          <Link to="/pengaturan">Pengaturan</Link>).
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
