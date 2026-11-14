import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Pencil, RefreshCw, Sparkles } from "lucide-react";
import { Alert } from "@/components/arc/alert/alert";
import { Avatar } from "@/components/arc/avatar/avatar";
import { Badge } from "@/components/arc/badge/badge";
import { Button } from "@/components/arc/button/button";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import { listAssets, updateMeeting } from "@/lib/db";
import { MODEL_OPTIONS, useSettings } from "@/lib/settings";
import { emptyMinutes, type Asset, type Meeting } from "@/lib/types";
import { drawVisualSummary, hasVisualContent } from "@/lib/visual";
import { ExportPanel } from "./ExportPanel";
import { MinutesEditor } from "./MinutesEditor";
import type { MinutesGenerator } from "./useMinutesGenerator";

export function MinutesTab({ meeting, generator, onOpenTab }: { meeting: Meeting; generator: MinutesGenerator; onOpenTab: (tab: string) => void }) {
  const settings = useSettings();
  const images = useLiveQuery(() => listAssets(meeting.id, "image"), [meeting.id]) ?? [];
  const [editing, setEditing] = useState(false);
  const minutes = meeting.minutes;
  const hasTranscript = meeting.segments.length > 0;
  const hasKey = settings.anthropicKey.trim().length > 0;

  if (generator.working) {
    return (
      <div className="panel working" aria-busy="true">
        <TextShimmer as="p">Menyusun notulen dari transkrip</TextShimmer>
        <p className="muted small" style={{ fontVariantNumeric: "tabular-nums" }}>
          {generator.progress > 0 ? `${generator.progress.toLocaleString("id-ID")} karakter ditulis` : "Claude sedang membaca transkrip. Rapat panjang bisa butuh satu sampai dua menit."}
        </p>
        <Button variant="secondary" onClick={generator.cancel}>
          Batalkan
        </Button>
      </div>
    );
  }

  if (editing) {
    return (
      <MinutesEditor
        minutes={minutes ?? emptyMinutes()}
        onCancel={() => setEditing(false)}
        onSave={async (next) => {
          await updateMeeting(meeting.id, { minutes: next });
          setEditing(false);
        }}
      />
    );
  }

  const errorAlert = generator.error ? (
    <Alert tone="danger" title="Notulen belum berhasil dibuat" onDismiss={generator.clearError}>
      {generator.error}
    </Alert>
  ) : null;

  if (!minutes) {
    return (
      <div className="stack">
        {errorAlert}
        {!hasKey ? (
          <Alert tone="info" title="Ringkasan otomatis butuh kunci API Claude">
            Isi kunci API di <Link to="/pengaturan">Pengaturan</Link> agar Notula bisa menyusun notulen dari transkrip. Tanpa kunci, Anda tetap bisa menulis notulen sendiri dan mengekspornya.
          </Alert>
        ) : null}
        <EmptyState
          title="Notulen belum dibuat"
          description={
            hasTranscript
              ? "Notula merangkum transkrip menjadi pembukaan, tujuan, isi pembahasan, keputusan, tindak lanjut, dan rangkuman."
              : "Tambahkan transkrip lebih dulu: rekam rapat, impor berkas, atau tempel catatan."
          }
          action={
            <div className="row">
              {hasTranscript ? (
                <Button className="tone-blue" onClick={() => void generator.generate()} disabled={!hasKey}>
                  <Sparkles size={18} strokeWidth={1.75} aria-hidden="true" />
                  Buat notulen
                </Button>
              ) : (
                <Button className="tone-blue" onClick={() => onOpenTab("transkrip")}>
                  Tambah transkrip
                </Button>
              )}
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Tulis sendiri
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  const modelLabel = MODEL_OPTIONS.find((option) => option.value === minutes.model)?.label.split(" (")[0];
  const attendees = meeting.attendees.filter((attendee) => attendee.name.trim());

  return (
    <div className="minutes">
      {errorAlert}
      <div className="sectionHead">
        <Badge tone={minutes.source === "ai" ? "info" : "neutral"}>{minutes.source === "ai" ? `Disusun oleh ${modelLabel ?? "Claude"}` : "Ditulis manual"}</Badge>
        <div className="row">
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            <Pencil size={16} strokeWidth={1.75} aria-hidden="true" />
            Ubah
          </Button>
          {hasTranscript && hasKey ? (
            <Button variant="secondary" size="sm" onClick={() => void generator.generate()}>
              <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />
              Buat ulang
            </Button>
          ) : null}
        </div>
      </div>

      {minutes.topic || minutes.opening ? (
        <section className="minutesSection" aria-labelledby="m-pembukaan">
          <h2 id="m-pembukaan">Pembukaan</h2>
          {minutes.topic ? <p className="topic">{minutes.topic}</p> : null}
          {minutes.opening ? <p className="prose">{minutes.opening}</p> : null}
        </section>
      ) : null}

      {minutes.objectives.length > 0 ? (
        <section className="minutesSection" aria-labelledby="m-tujuan">
          <h2 id="m-tujuan">Tujuan</h2>
          <ul className="bullets">
            {minutes.objectives.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {minutes.discussion.length > 0 ? (
        <section className="minutesSection" aria-labelledby="m-isi">
          <h2 id="m-isi">Isi pembahasan</h2>
          <div className="discussion">
            {minutes.discussion.map((item, index) => (
              <article key={index}>
                <h3>
                  {index + 1}. {item.heading || "Pembahasan"}
                </h3>
                {item.summary ? <p className="prose">{item.summary}</p> : null}
                {item.points.length > 0 ? (
                  <ul className="bullets">
                    {item.points.map((point, pointIndex) => (
                      <li key={pointIndex}>{point}</li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {minutes.decisions.length > 0 ? (
        <section className="minutesSection" aria-labelledby="m-keputusan">
          <h2 id="m-keputusan">Keputusan</h2>
          <ol className="bullets">
            {minutes.decisions.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ol>
        </section>
      ) : null}

      {minutes.actionItems.length > 0 ? (
        <section className="minutesSection" aria-labelledby="m-tindak">
          <h2 id="m-tindak">Tindak lanjut</h2>
          <div className="tableCard">
            <div className="tableScroll">
              <table className="dataTable">
                <thead>
                  <tr>
                    <th className="num">No</th>
                    <th>Tugas</th>
                    <th>Penanggung jawab</th>
                    <th>Tenggat</th>
                  </tr>
                </thead>
                <tbody>
                  {minutes.actionItems.map((item, index) => (
                    <tr key={index}>
                      <td className="num">{index + 1}</td>
                      <td style={{ minWidth: 220 }}>{item.task}</td>
                      <td>{item.owner || "-"}</td>
                      <td>{item.due || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}

      {minutes.summary ? (
        <section className="minutesSection" aria-labelledby="m-rangkuman">
          <h2 id="m-rangkuman">Rangkuman</h2>
          <p className="prose">{minutes.summary}</p>
        </section>
      ) : null}

      {hasVisualContent(meeting) ? (
        <section className="minutesSection" aria-labelledby="m-visual">
          <h2 id="m-visual">Ringkasan visual</h2>
          <VisualSummary meeting={meeting} />
        </section>
      ) : null}

      <section className="minutesSection" aria-labelledby="m-gambar">
        <div className="sectionHead">
          <h2 id="m-gambar">Dokumentasi</h2>
          <button type="button" className="linkButton" onClick={() => onOpenTab("gambar")}>
            {images.length > 0 ? "Kelola gambar" : "Tambah gambar"}
          </button>
        </div>
        {images.length > 0 ? (
          <div className="gallery">
            {images.map((image) => (
              <Figure key={image.id} image={image} />
            ))}
          </div>
        ) : (
          <p className="muted">Belum ada gambar. Foto papan tulis atau tangkapan layar presentasi akan ikut masuk ke notulen dan ekspor.</p>
        )}
      </section>

      <section className="minutesSection" aria-labelledby="m-hadir">
        <div className="sectionHead">
          <h2 id="m-hadir">Daftar hadir</h2>
          <button type="button" className="linkButton" onClick={() => onOpenTab("peserta")}>
            {attendees.length > 0 ? "Kelola peserta" : "Tambah peserta"}
          </button>
        </div>
        {attendees.length > 0 ? (
          <div className="people">
            {attendees.map((attendee) => (
              <span key={attendee.id} className={attendee.present ? "person" : "person absent"}>
                <Avatar name={attendee.name} size="sm" />
                <span>
                  {attendee.name}
                  {attendee.role ? <span className="muted small">, {attendee.role}</span> : null}
                  {!attendee.present ? <span className="small"> (tidak hadir)</span> : null}
                </span>
              </span>
            ))}
          </div>
        ) : (
          <p className="muted">Daftar hadir belum diisi.</p>
        )}
      </section>

      <section className="minutesSection" aria-labelledby="m-ekspor">
        <h2 id="m-ekspor">Ekspor</h2>
        <ExportPanel meeting={meeting} />
      </section>
    </div>
  );
}

/** The same drawing that goes into the exported files, shown on a canvas. */
function VisualSummary({ meeting }: { meeting: Meeting }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    const draw = () => {
      if (!cancelled && canvas.current) drawVisualSummary(canvas.current, meeting);
    };
    draw();
    // Draw again once the web fonts are in, so the text is set in the right face.
    void document.fonts?.ready.then(draw);
    return () => {
      cancelled = true;
    };
  }, [meeting]);
  return <canvas ref={canvas} className="visual" role="img" aria-label={`Ringkasan visual rapat ${meeting.title}`} />;
}

export function Figure({ image }: { image: Asset }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const objectUrl = URL.createObjectURL(image.blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [image.blob]);
  return (
    <figure className="figure">
      {url ? <img src={url} alt={image.caption || image.name} loading="lazy" /> : <div className="visual" style={{ aspectRatio: "4 / 3" }} />}
      {image.caption ? <figcaption>{image.caption}</figcaption> : null}
    </figure>
  );
}
