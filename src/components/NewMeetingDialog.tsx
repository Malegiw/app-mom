import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/arc/button/button";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { Input } from "@/components/arc/input/input";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { Select } from "@/components/arc/select/select";
import { createMeeting } from "@/lib/db";
import { nowHHMM, todayISO } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { PLATFORM_LABEL, type Lang, type Platform } from "@/lib/types";

export const PLATFORM_OPTIONS = (Object.keys(PLATFORM_LABEL) as Platform[]).map((value) => ({ value, label: PLATFORM_LABEL[value] }));
export const LANGUAGE_OPTIONS = [
  { value: "id", label: "Indonesia" },
  { value: "en", label: "English" },
];

export function NewMeetingDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Rapat baru" description="Isi seperlunya. Semua bisa diubah nanti.">
        {/* Mounted only while open, so every new meeting starts from today's date and the current time. */}
        <NewMeetingForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function NewMeetingForm({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [platform, setPlatform] = useState<Platform>("offline");
  const [date, setDate] = useState(todayISO);
  const [startTime, setStartTime] = useState(nowHHMM);
  const [language, setLanguage] = useState<Lang>(() => getSettings().language);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const meeting = await createMeeting({ title, platform, date, startTime, language, notetaker: getSettings().notetaker });
      onDone();
      navigate(`/rapat/${meeting.id}?tab=transkrip`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <Input label="Judul rapat" placeholder="Contoh: Rapat koordinasi mingguan" value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
      <Select label="Pelaksanaan" options={PLATFORM_OPTIONS} value={platform} onValueChange={(value) => setPlatform(value as Platform)} />
      <div className="fieldGrid">
        <Input label="Tanggal" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        <Input label="Waktu mulai" type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
      </div>
      <div className="labeled">
        <span id="new-language">Bahasa yang dipakai di rapat</span>
        <SegmentedControl label="Bahasa yang dipakai di rapat" options={LANGUAGE_OPTIONS} value={language} onValueChange={(value) => setLanguage(value as Lang)} fullWidth />
      </div>
      <div className="formActions">
        <Button type="button" variant="ghost" onClick={onDone}>
          Batal
        </Button>
        <Button type="submit" className="tone-blue" loading={saving}>
          Buat rapat
        </Button>
      </div>
    </form>
  );
}
