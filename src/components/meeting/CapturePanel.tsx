import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Mic, Pause, Play, Square, Upload } from "lucide-react";
import { Alert } from "@/components/arc/alert/alert";
import { Button } from "@/components/arc/button/button";
import { Progress } from "@/components/arc/progress/progress";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { Select } from "@/components/arc/select/select";
import { Switch } from "@/components/arc/switch/switch";
import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import { Textarea } from "@/components/arc/textarea/textarea";
import { appendSegments } from "@/lib/db";
import { useEngine } from "@/lib/engine";
import { cancelImport, clearImport, startImport, useImportJobs } from "@/lib/importJobs";
import { formatClock } from "@/lib/format";
import { canCaptureOnlineAudio, canRecord, type AudioSource } from "@/lib/recorder";
import { getSettings, saveSettings, useSettings } from "@/lib/settings";
import { speechSupported } from "@/lib/speech";
import { lastTimestamp, parseTranscript } from "@/lib/transcript";
import type { Meeting } from "@/lib/types";
import { pickProvider } from "./useMinutesGenerator";
import type { LiveMode, Recorder } from "./useRecorder";

type Mode = "record" | "import" | "paste";

const MODES = [
  { value: "record", label: "Dengarkan" },
  { value: "import", label: "Impor berkas" },
  { value: "paste", label: "Tempel teks" },
];

const IMPORT_ACCEPT = ".vtt,.srt,.txt,.docx,audio/*,video/*,.mp3,.m4a,.wav,.mp4,.mov,.mkv,.webm,.ogg";

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
  const jobs = useImportJobs(meeting.id);
  const picker = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function add(files: FileList | File[]) {
    const { importAudioOnly } = getSettings();
    for (const file of Array.from(files)) startImport(meeting.id, file, { language: meeting.language, audioOnly: importAudioOnly });
  }

  return (
    <div className="stack">
      <div
        className={`importDrop${over ? " over" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          add(event.dataTransfer.files);
        }}
      >
        <Upload size={28} strokeWidth={1.75} aria-hidden="true" />
        <strong>Impor transkrip atau rekaman</strong>
        <p className="muted small">Transkrip Teams, Zoom, atau Meet (.vtt, .docx, .srt, .txt), atau rekaman audio dan video</p>
        <Button className="tone-blue" onClick={() => picker.current?.click()}>
          Pilih berkas
        </Button>
        <input
          ref={picker}
          type="file"
          accept={IMPORT_ACCEPT}
          multiple
          hidden
          onChange={(event) => {
            if (event.target.files) add(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      <div className="group">
        <div className="optionRow">
          <div className="optionText">
            <strong id="opt-audio">Ambil audionya saja dari video</strong>
            <p>
              Rekaman Teams berukuran ratusan megabita, padahal yang dibutuhkan hanya suaranya. Dengan ini, video diubah menjadi audio kecil (sekitar 20 MB per jam) sebelum dikirim dan disimpan. Matikan bila video aslinya ingin disimpan juga.
            </p>
          </div>
          <Switch aria-labelledby="opt-audio" checked={settings.importAudioOnly} onCheckedChange={(checked) => saveSettings({ importAudioOnly: checked })} />
        </div>
      </div>

      {jobs.length > 0 ? (
        <ul className="importJobs" aria-live="polite">
          {jobs.map((job) => (
            <li key={job.id} className={`importJob ${job.status}`}>
              <div className="importJobHead">
                <strong title={job.name}>{job.name}</strong>
                <span className="muted small">{formatBytes(job.size)}{job.keptBytes ? ` → ${formatBytes(job.keptBytes)}` : ""}</span>
              </div>
              {job.status === "working" ? (
                <>
                  <Progress value={job.percent} label={job.step} showValue />
                  <p className="muted small">Boleh pindah tab. Impor tetap berjalan selama Notula terbuka.</p>
                  <Button variant="secondary" size="sm" onClick={() => cancelImport(job.id)}>
                    Batalkan
                  </Button>
                </>
              ) : job.status === "done" ? (
                <p className="small" role="status">
                  Selesai. Transkrip sudah ditambahkan, lihat di tab Transkrip.
                </p>
              ) : (
                <>
                  <p className="small" role={job.status === "failed" ? "alert" : undefined}>
                    {job.status === "failed" ? job.error : "Dibatalkan."}
                  </p>
                </>
              )}
              {job.status !== "working" ? (
                <Button variant="ghost" size="sm" onClick={() => clearImport(job.id)}>
                  Tutup
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

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

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
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
