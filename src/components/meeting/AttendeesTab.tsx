import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/arc/button/button";
import { EmptyState } from "@/components/arc/empty-state/empty-state";
import { Switch } from "@/components/arc/switch/switch";
import { updateMeeting } from "@/lib/db";
import { uniqueSpeakers } from "@/lib/transcript";
import { uid, type Attendee, type Meeting } from "@/lib/types";

const isGenericLabel = (name: string) => /^(pembicara|speaker)\s*\d*$/i.test(name.trim());

/** The attendance list. Edits are kept locally while typing and written to storage shortly after. */
export function AttendeesTab({ meeting }: { meeting: Meeting }) {
  const [rows, setRows] = useState<Attendee[]>(meeting.attendees);
  const dirty = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(rows);
  latest.current = rows;

  // Pick up changes made elsewhere, such as names the summary found, unless an edit is still waiting to be saved.
  useEffect(() => {
    if (!dirty.current) setRows(meeting.attendees);
  }, [meeting.attendees]);

  const flush = () => {
    window.clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    void updateMeeting(meeting.id, { attendees: latest.current });
  };
  useEffect(() => flush, []); // eslint-disable-line react-hooks/exhaustive-deps

  function change(next: Attendee[]) {
    setRows(next);
    latest.current = next;
    dirty.current = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 400);
  }

  const patch = (id: string, value: Partial<Attendee>) => change(rows.map((row) => (row.id === id ? { ...row, ...value } : row)));
  const add = () => change([...rows, { id: uid(), name: "", role: "", org: "", present: true }]);

  const missingSpeakers = useMemo(() => {
    const known = new Set(rows.map((row) => row.name.trim().toLowerCase()));
    return uniqueSpeakers(meeting.segments).filter((name) => !isGenericLabel(name) && !known.has(name.toLowerCase()));
  }, [meeting.segments, rows]);

  const addSpeakers = () => change([...rows, ...missingSpeakers.map((name) => ({ id: uid(), name, role: "", org: "", present: true }))]);

  const present = rows.filter((row) => row.name.trim() && row.present).length;
  const named = rows.filter((row) => row.name.trim()).length;

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Daftar hadir masih kosong"
        description="Tambahkan peserta satu per satu, atau ambil nama pembicara dari transkrip. Daftar ini masuk ke notulen dan semua ekspor."
        action={
          <div className="row">
            <Button className="tone-blue" onClick={add}>
              <Plus size={18} strokeWidth={1.75} aria-hidden="true" />
              Tambah peserta
            </Button>
            {missingSpeakers.length > 0 ? (
              <Button variant="secondary" onClick={addSpeakers}>
                Ambil {missingSpeakers.length} nama dari transkrip
              </Button>
            ) : null}
          </div>
        }
      />
    );
  }

  return (
    <section className="stack" aria-labelledby="daftar-hadir">
      <div className="sectionHead">
        <div>
          <h2 id="daftar-hadir" className="sectionTitle">
            Daftar hadir
          </h2>
          <p className="muted small">
            {present} dari {named} orang hadir
          </p>
        </div>
        <div className="row">
          {missingSpeakers.length > 0 ? (
            <Button variant="secondary" size="sm" onClick={addSpeakers}>
              <UserPlus size={16} strokeWidth={1.75} aria-hidden="true" />
              Ambil {missingSpeakers.length} nama dari transkrip
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" onClick={add}>
            <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
            Tambah peserta
          </Button>
        </div>
      </div>

      <div className="group">
        <div className="attendeeRow attendeeHead" aria-hidden="true">
          <span>Nama</span>
          <span>Jabatan atau peran</span>
          <span>Instansi</span>
          <span style={{ minWidth: 112 }}>Kehadiran</span>
          <span style={{ width: "var(--control-height-md)" }} />
        </div>
        {rows.map((row, index) => (
          <div key={row.id} className="attendeeRow">
            <input className="bareInput wide" aria-label={`Nama peserta ${index + 1}`} placeholder="Nama" value={row.name} onChange={(event) => patch(row.id, { name: event.target.value })} onBlur={flush} />
            <input className="bareInput wide" aria-label={`Jabatan peserta ${index + 1}`} placeholder="Jabatan atau peran" value={row.role} onChange={(event) => patch(row.id, { role: event.target.value })} onBlur={flush} />
            <input className="bareInput wide" aria-label={`Instansi peserta ${index + 1}`} placeholder="Instansi" value={row.org} onChange={(event) => patch(row.id, { org: event.target.value })} onBlur={flush} />
            <label className="presence">
              <Switch checked={row.present} onCheckedChange={(checked) => patch(row.id, { present: checked })} aria-label={`Kehadiran ${row.name || `peserta ${index + 1}`}`} />
              {row.present ? "Hadir" : "Tidak hadir"}
            </label>
            <button type="button" className="iconButton danger" onClick={() => change(rows.filter((item) => item.id !== row.id))} aria-label={`Hapus ${row.name || `peserta ${index + 1}`}`}>
              <Trash2 size={18} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
