import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { CalendarDays, ChevronRight, Clock, Users, Video } from "lucide-react";
import { Badge } from "@/components/arc/badge/badge";
import { Button } from "@/components/arc/button/button";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
import { MetricCard } from "@/components/arc/metric-card/metric-card";
import { SearchField } from "@/components/arc/search-field/search-field";
import { Skeleton } from "@/components/arc/skeleton/skeleton";
import { NewMeetingDialog } from "@/components/NewMeetingDialog";
import { addAsset, db } from "@/lib/db";
import { formatDate, formatDuration } from "@/lib/format";
import { buildSampleMeeting, drawSampleImage, SAMPLE_IMAGE_CAPTION } from "@/lib/sample";
import { PLATFORM_LABEL, type Meeting } from "@/lib/types";

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;

function statusOf(meeting: Meeting): { label: string; tone: "success" | "info" | "neutral" } {
  if (meeting.minutes) return { label: "Notulen siap", tone: "success" };
  if (meeting.segments.length > 0) return { label: "Transkrip siap", tone: "info" };
  return { label: "Draf", tone: "neutral" };
}

export function HomePage() {
  const navigate = useNavigate();
  const meetings = useLiveQuery(() => db.meetings.orderBy("updatedAt").reverse().toArray(), []);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!meetings || !needle) return meetings ?? [];
    return meetings.filter((meeting) =>
      [meeting.title, meeting.location, meeting.organizer, meeting.minutes?.topic ?? "", ...meeting.attendees.map((a) => a.name)]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [meetings, query]);

  const totals = useMemo(() => {
    const list = meetings ?? [];
    return {
      count: list.length,
      minutes: Math.round(list.reduce((sum, meeting) => sum + meeting.durationSec, 0) / 60),
      actions: list.reduce((sum, meeting) => sum + (meeting.minutes?.actionItems.length ?? 0), 0),
      withMinutes: list.filter((meeting) => meeting.minutes).length,
    };
  }, [meetings]);

  async function openSample() {
    setLoadingSample(true);
    try {
      const sample = buildSampleMeeting();
      await db.meetings.add(sample);
      const picture = await drawSampleImage();
      await addAsset({ meetingId: sample.id, kind: "image", name: "papan-tulis.jpg", mime: "image/jpeg", blob: picture.blob, caption: SAMPLE_IMAGE_CAPTION, width: picture.width, height: picture.height });
      navigate(`/rapat/${sample.id}`);
    } finally {
      setLoadingSample(false);
    }
  }

  return (
    <main className="page">
      <div className="pageHead">
        <div>
          <h1 className="pageTitle">Rapat</h1>
          <p className="lede">Rekam rapat Teams, Zoom, atau tatap muka. Notula menyusun transkrip dan notulen, lalu mengekspornya ke Word, Excel, dan PowerPoint.</p>
        </div>
      </div>

      {meetings === undefined ? (
        <div className="panel" aria-busy="true">
          <Skeleton label="Memuat daftar rapat" lines={4} />
        </div>
      ) : meetings.length === 0 ? (
        <EmptyState
          title="Belum ada rapat"
          description="Buat rapat pertama untuk mulai merekam, atau buka rapat contoh untuk melihat hasil notulen dan ekspornya."
          action={
            <div className="row">
              <Button className="tone-blue" onClick={() => setCreating(true)}>
                Buat rapat pertama
              </Button>
              <Button variant="secondary" onClick={openSample} loading={loadingSample}>
                Buka rapat contoh
              </Button>
            </div>
          }
        />
      ) : (
        <div className="homeBody">
          <div className="metrics">
            <MetricCard label="Rapat tercatat" value={totals.count} context={`${totals.withMinutes} sudah punya notulen`} />
            <MetricCard label="Lama rapat terekam" value={totals.minutes} suffix={"\u00a0menit"} context="Jumlah dari semua rapat" />
            <MetricCard label="Tindak lanjut" value={totals.actions} context="Dari semua notulen" />
          </div>

          <section className="stack" aria-labelledby="daftar-rapat">
            <div className="sectionHead">
              <h2 id="daftar-rapat" className="sectionTitle">
                Semua rapat
              </h2>
              <div style={{ flex: "0 1 320px", minWidth: 0 }}>
                <SearchField label="Cari rapat" placeholder="Judul, peserta, atau topik" value={query} onValueChange={setQuery} />
              </div>
            </div>

            {filtered.length === 0 ? (
              <EmptyState title="Tidak ada rapat yang cocok" description={`Tidak ada rapat dengan kata "${query}". Coba kata lain atau hapus pencarian.`} action={<Button variant="secondary" onClick={() => setQuery("")}>Hapus pencarian</Button>} />
            ) : (
              <div className="group">
                {filtered.map((meeting) => {
                  const status = statusOf(meeting);
                  const people = meeting.attendees.filter((a) => a.name.trim()).length;
                  return (
                    <Link key={meeting.id} to={`/rapat/${meeting.id}`} className="meetingRow">
                      <div style={{ minWidth: 0 }}>
                        <h3>{meeting.title}</h3>
                        <div className="meetingMeta">
                          <span>
                            <CalendarDays {...ICON} />
                            {formatDate(meeting.date, false)}
                            {meeting.startTime ? `, ${meeting.startTime}` : ""}
                          </span>
                          <span>
                            <Video {...ICON} />
                            {PLATFORM_LABEL[meeting.platform]}
                          </span>
                          {meeting.durationSec > 0 ? (
                            <span>
                              <Clock {...ICON} />
                              {formatDuration(meeting.durationSec)}
                            </span>
                          ) : null}
                          {people > 0 ? (
                            <span>
                              <Users {...ICON} />
                              {people} peserta
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="rowEnd">
                        {meeting.isSample ? (
                          <span className="hideSmall">
                            <Badge tone="neutral">Contoh</Badge>
                          </span>
                        ) : null}
                        <Badge tone={status.tone}>{status.label}</Badge>
                        <ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      <NewMeetingDialog open={creating} onOpenChange={setCreating} />
    </main>
  );
}
