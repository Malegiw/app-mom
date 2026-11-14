import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { CalendarDays, ChevronLeft, Clock, MapPin, Pencil, Sparkles, Square, Video } from "lucide-react";
import { Alert } from "@/components/arc/alert/alert";
import { Button } from "@/components/arc/button/button";
import { ConfirmMorph } from "@/components/arc/confirm-morph/confirm-morph";
import { DropdownMenu } from "@/components/arc/dropdown-menu/dropdown-menu";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
import { Skeleton } from "@/components/arc/skeleton/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/arc/tabs/tabs";
import { AttendeesTab } from "@/components/meeting/AttendeesTab";
import { useExporter } from "@/components/meeting/ExportPanel";
import { ImagesTab } from "@/components/meeting/ImagesTab";
import { MeetingDetailsDialog } from "@/components/meeting/MeetingDetailsDialog";
import { MinutesTab } from "@/components/meeting/MinutesTab";
import { TranscriptTab } from "@/components/meeting/TranscriptTab";
import { useMinutesGenerator } from "@/components/meeting/useMinutesGenerator";
import { useRecorder } from "@/components/meeting/useRecorder";
import { useToast } from "@/components/Toaster";
import { db, deleteMeeting } from "@/lib/db";
import { EXPORT_INFO, type ExportKind } from "@/lib/export";
import { formatClock, formatDate, formatDuration, formatTimeRange } from "@/lib/format";
import { useSettings } from "@/lib/settings";
import { PLATFORM_LABEL, type Meeting } from "@/lib/types";

const TABS = ["notulen", "transkrip", "peserta", "gambar"] as const;
type TabId = (typeof TABS)[number];
const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;

export function MeetingPage() {
  const { id = "" } = useParams();
  // `null` once the lookup has finished and found nothing; `undefined` while it is still loading.
  const meeting = useLiveQuery(async () => (await db.meetings.get(id)) ?? null, [id]);

  if (meeting === undefined) {
    return (
      <main className="page" aria-busy="true">
        <Skeleton label="Memuat rapat" lines={5} />
      </main>
    );
  }
  if (meeting === null) {
    return (
      <main className="page">
        <EmptyState
          title="Rapat tidak ditemukan"
          description="Rapat ini mungkin sudah dihapus, atau dibuat di perangkat lain. Data Notula tersimpan di tiap perangkat."
          action={
            <Link to="/">
              <Button className="tone-blue">Lihat semua rapat</Button>
            </Link>
          }
        />
      </main>
    );
  }
  return <MeetingWorkspace key={meeting.id} meeting={meeting} />;
}

function MeetingWorkspace({ meeting }: { meeting: Meeting }) {
  const navigate = useNavigate();
  const notify = useToast();
  const settings = useSettings();
  const [params, setParams] = useSearchParams();
  const recorder = useRecorder(meeting);
  const generator = useMinutesGenerator(meeting);
  const exporter = useExporter(meeting);
  const [editingDetails, setEditingDetails] = useState(false);

  const requested = params.get("tab") as TabId | null;
  const tab: TabId = requested && TABS.includes(requested) ? requested : meeting.segments.length === 0 && !meeting.minutes ? "transkrip" : "notulen";
  const openTab = (next: string) => setParams({ tab: next }, { replace: true });

  const recordingNow = recorder.status === "recording" || recorder.status === "paused" || recorder.status === "saving";
  const hasKey = settings.anthropicKey.trim().length > 0;
  const canSummarize = meeting.segments.length > 0 && !recordingNow;
  const timeRange = formatTimeRange(meeting);

  async function runExport(kind: ExportKind) {
    notify(`Menyiapkan berkas ${EXPORT_INFO[kind].label}`);
    const fileName = await exporter.run(kind);
    if (fileName) notify(`Berkas ${EXPORT_INFO[kind].label} tersimpan`, fileName);
    else notify(`Berkas ${EXPORT_INFO[kind].label} gagal dibuat`, "Coba lagi dari bagian Ekspor di tab Notulen.");
  }

  async function summarize() {
    // Without a key the minutes tab explains what is missing, so take the person there either way.
    openTab("notulen");
    if (hasKey) await generator.generate();
  }

  return (
    <main className="page">
      <div className="stack">
        <Link to="/" className="backLink">
          <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />
          Semua rapat
        </Link>

        <div className="pageHead">
          <div className="grow">
            <h1 className="meetingTitle">{meeting.title}</h1>
            <div className="metaLine">
              <span>
                <CalendarDays {...ICON} />
                {formatDate(meeting.date)}
              </span>
              {timeRange ? (
                <span>
                  <Clock {...ICON} />
                  {timeRange}
                  {meeting.durationSec >= 60 ? ` (${formatDuration(meeting.durationSec)})` : ""}
                </span>
              ) : null}
              <span>
                <Video {...ICON} />
                {PLATFORM_LABEL[meeting.platform]}
              </span>
              {meeting.location ? (
                <span>
                  <MapPin {...ICON} />
                  {meeting.location}
                </span>
              ) : null}
            </div>
          </div>
          <div className="headActions">
            {!meeting.minutes ? (
              <Button className="tone-blue" onClick={() => void summarize()} disabled={!canSummarize} loading={generator.working}>
                <Sparkles size={18} strokeWidth={1.75} aria-hidden="true" />
                Buat notulen
              </Button>
            ) : null}
            <DropdownMenu
              label="Ekspor"
              items={[
                { label: "Word (.docx)", onSelect: () => void runExport("docx") },
                { label: "Excel (.xlsx)", onSelect: () => void runExport("xlsx") },
                { label: "PowerPoint (.pptx)", onSelect: () => void runExport("pptx") },
              ]}
            />
            <Button variant="secondary" onClick={() => setEditingDetails(true)}>
              <Pencil size={16} strokeWidth={1.75} aria-hidden="true" />
              Ubah detail
            </Button>
          </div>
        </div>
      </div>

      {meeting.isSample ? (
        <Alert tone="info" title="Ini rapat contoh">
          Semua nama dan isi rapat ini fiktif. Gunakan untuk mencoba notulen dan ekspor, lalu hapus kapan saja.
        </Alert>
      ) : null}

      {recordingNow && tab !== "transkrip" ? (
        <div className="recordingBar" role="status">
          <span className={recorder.status === "paused" ? "recDot paused" : "recDot"} aria-hidden="true" />
          <span className="timer">{formatClock(recorder.elapsed)}</span>
          <span className="grow muted">{recorder.status === "paused" ? "Rekaman dijeda" : "Sedang merekam"}</span>
          <Button variant="secondary" size="sm" onClick={() => openTab("transkrip")}>
            Lihat transkrip
          </Button>
          <Button size="sm" className="tone-orange" onClick={() => void recorder.stop()} loading={recorder.status === "saving"}>
            <Square size={14} strokeWidth={2} aria-hidden="true" />
            Selesai
          </Button>
        </div>
      ) : null}

      <Tabs value={tab} onValueChange={openTab}>
        <TabsList aria-label="Bagian rapat">
          <TabsTrigger value="notulen">Notulen</TabsTrigger>
          <TabsTrigger value="transkrip">Transkrip</TabsTrigger>
          <TabsTrigger value="peserta">Peserta</TabsTrigger>
          <TabsTrigger value="gambar">Gambar</TabsTrigger>
        </TabsList>
        <TabsContent value="notulen" className="tabPanel">
          <MinutesTab meeting={meeting} generator={generator} onOpenTab={openTab} />
        </TabsContent>
        <TabsContent value="transkrip" className="tabPanel">
          <TranscriptTab meeting={meeting} recorder={recorder} />
        </TabsContent>
        <TabsContent value="peserta" className="tabPanel">
          <AttendeesTab meeting={meeting} />
        </TabsContent>
        <TabsContent value="gambar" className="tabPanel">
          <ImagesTab meeting={meeting} />
        </TabsContent>
      </Tabs>

      <section className="stack tight" aria-labelledby="hapus-rapat" style={{ marginTop: "var(--space-8)" }}>
        <h2 id="hapus-rapat" className="sectionTitle">
          Hapus rapat
        </h2>
        <p className="muted small">Transkrip, notulen, rekaman, dan gambar rapat ini ikut terhapus dari perangkat dan tidak bisa dikembalikan.</p>
        <div>
          <ConfirmMorph
            label="Hapus rapat ini"
            prompt="Hapus rapat ini selamanya?"
            confirmLabel="Hapus"
            onConfirm={async () => {
              await deleteMeeting(meeting.id);
              navigate("/", { replace: true });
            }}
          />
        </div>
      </section>

      <MeetingDetailsDialog meeting={meeting} open={editingDetails} onOpenChange={setEditingDetails} />
    </main>
  );
}
