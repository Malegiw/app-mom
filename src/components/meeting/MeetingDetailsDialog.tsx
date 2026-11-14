import { useState, type FormEvent } from "react";
import { Button } from "@/components/arc/button/button";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { Input } from "@/components/arc/input/input";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { Select } from "@/components/arc/select/select";
import { LANGUAGE_OPTIONS, PLATFORM_OPTIONS } from "@/components/NewMeetingDialog";
import { updateMeeting } from "@/lib/db";
import type { Lang, Meeting, Platform } from "@/lib/types";

export function MeetingDetailsDialog({ meeting, open, onOpenChange }: { meeting: Meeting; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Detail rapat" description="Detail ini tampil di kepala notulen dan semua ekspor.">
        <DetailsForm meeting={meeting} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function DetailsForm({ meeting, onDone }: { meeting: Meeting; onDone: () => void }) {
  const [draft, setDraft] = useState({
    title: meeting.title,
    date: meeting.date,
    startTime: meeting.startTime,
    endTime: meeting.endTime,
    platform: meeting.platform,
    location: meeting.location,
    organizer: meeting.organizer,
    notetaker: meeting.notetaker,
    language: meeting.language,
  });
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => setDraft((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await updateMeeting(meeting.id, { ...draft, title: draft.title.trim() || meeting.title });
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <Input label="Judul rapat" value={draft.title} onChange={(event) => set("title", event.target.value)} />
      <div className="fieldGrid">
        <Input label="Tanggal" type="date" value={draft.date} onChange={(event) => set("date", event.target.value)} />
        <Select label="Pelaksanaan" options={PLATFORM_OPTIONS} value={draft.platform} onValueChange={(value) => set("platform", value as Platform)} />
        <Input label="Waktu mulai" type="time" value={draft.startTime} onChange={(event) => set("startTime", event.target.value)} />
        <Input label="Waktu selesai" type="time" value={draft.endTime} onChange={(event) => set("endTime", event.target.value)} />
        <div className="span2">
          <Input label="Lokasi atau tautan rapat" value={draft.location} onChange={(event) => set("location", event.target.value)} />
        </div>
        <Input label="Pemimpin rapat" value={draft.organizer} onChange={(event) => set("organizer", event.target.value)} />
        <Input label="Notulis" value={draft.notetaker} onChange={(event) => set("notetaker", event.target.value)} />
      </div>
      <div className="labeled">
        <span>Bahasa yang dipakai di rapat</span>
        <SegmentedControl label="Bahasa yang dipakai di rapat" options={LANGUAGE_OPTIONS} value={draft.language} onValueChange={(value) => set("language", value as Lang)} fullWidth />
      </div>
      <div className="formActions">
        <Button type="button" variant="ghost" onClick={onDone}>
          Batal
        </Button>
        <Button type="submit" className="tone-blue" loading={saving}>
          Simpan detail
        </Button>
      </div>
    </form>
  );
}
