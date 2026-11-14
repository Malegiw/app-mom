import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { Textarea } from "@/components/arc/textarea/textarea";
import type { ActionItem, DiscussionItem, Minutes } from "@/lib/types";

const toLines = (items: string[]) => items.join("\n");
const fromLines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);

/** Edit every part of the minutes by hand. Lists are typed one item per line. */
export function MinutesEditor({ minutes, onSave, onCancel }: { minutes: Minutes; onSave: (minutes: Minutes) => Promise<void>; onCancel: () => void }) {
  const [topic, setTopic] = useState(minutes.topic);
  const [opening, setOpening] = useState(minutes.opening);
  const [objectives, setObjectives] = useState(toLines(minutes.objectives));
  const [discussion, setDiscussion] = useState<(DiscussionItem & { pointsText: string })[]>(
    minutes.discussion.map((item) => ({ ...item, pointsText: toLines(item.points) })),
  );
  const [decisions, setDecisions] = useState(toLines(minutes.decisions));
  const [actions, setActions] = useState<ActionItem[]>(minutes.actionItems);
  const [summary, setSummary] = useState(minutes.summary);
  const [saving, setSaving] = useState(false);

  const patchDiscussion = (index: number, patch: Partial<DiscussionItem & { pointsText: string }>) =>
    setDiscussion((items) => items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  const patchAction = (index: number, patch: Partial<ActionItem>) => setActions((items) => items.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  async function save() {
    setSaving(true);
    try {
      await onSave({
        ...minutes,
        topic: topic.trim(),
        opening: opening.trim(),
        objectives: fromLines(objectives),
        discussion: discussion
          .map((item) => ({ heading: item.heading.trim(), summary: item.summary.trim(), points: fromLines(item.pointsText) }))
          .filter((item) => item.heading || item.summary || item.points.length > 0),
        decisions: fromLines(decisions),
        actionItems: actions.map((item) => ({ task: item.task.trim(), owner: item.owner.trim(), due: item.due.trim() })).filter((item) => item.task),
        summary: summary.trim(),
        generatedAt: Date.now(),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="stack loose"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <section className="stack" aria-labelledby="e-pembukaan">
        <h2 id="e-pembukaan" className="sectionTitle">
          Pembukaan
        </h2>
        <Input label="Topik rapat" value={topic} onChange={(event) => setTopic(event.target.value)} />
        <Textarea label="Pembukaan" rows={3} value={opening} onChange={(event) => setOpening(event.target.value)} />
        <Textarea label="Tujuan" description="Satu tujuan per baris." rows={4} value={objectives} onChange={(event) => setObjectives(event.target.value)} />
      </section>

      <section className="stack" aria-labelledby="e-isi">
        <div className="sectionHead">
          <h2 id="e-isi" className="sectionTitle">
            Isi pembahasan
          </h2>
          <Button type="button" variant="secondary" size="sm" onClick={() => setDiscussion((items) => [...items, { heading: "", summary: "", points: [], pointsText: "" }])}>
            <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
            Tambah pembahasan
          </Button>
        </div>
        {discussion.length === 0 ? <p className="muted">Belum ada pembahasan.</p> : null}
        {discussion.map((item, index) => (
          <div key={index} className="panel stack">
            <div className="sectionHead">
              <strong style={{ fontWeight: 500 }}>Pembahasan {index + 1}</strong>
              <button type="button" className="iconButton danger" onClick={() => setDiscussion((items) => items.filter((_, i) => i !== index))} aria-label={`Hapus pembahasan ${index + 1}`}>
                <Trash2 size={18} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
            <Input label="Judul" value={item.heading} onChange={(event) => patchDiscussion(index, { heading: event.target.value })} />
            <Textarea label="Ringkasan" rows={3} value={item.summary} onChange={(event) => patchDiscussion(index, { summary: event.target.value })} />
            <Textarea label="Poin penting" description="Satu poin per baris." rows={4} value={item.pointsText} onChange={(event) => patchDiscussion(index, { pointsText: event.target.value })} />
          </div>
        ))}
      </section>

      <section className="stack" aria-labelledby="e-keputusan">
        <h2 id="e-keputusan" className="sectionTitle">
          Keputusan
        </h2>
        <Textarea label="Keputusan" description="Satu keputusan per baris." rows={4} value={decisions} onChange={(event) => setDecisions(event.target.value)} />
      </section>

      <section className="stack" aria-labelledby="e-tindak">
        <div className="sectionHead">
          <h2 id="e-tindak" className="sectionTitle">
            Tindak lanjut
          </h2>
          <Button type="button" variant="secondary" size="sm" onClick={() => setActions((items) => [...items, { task: "", owner: "", due: "" }])}>
            <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
            Tambah tugas
          </Button>
        </div>
        {actions.length === 0 ? <p className="muted">Belum ada tindak lanjut.</p> : null}
        {actions.length > 0 ? (
          <div className="group">
            {actions.map((item, index) => (
              <div key={index} className="attendeeRow" style={{ gridTemplateColumns: "minmax(0, 2.2fr) minmax(0, 1.2fr) minmax(0, 1fr) auto" }}>
                <input className="bareInput wide" aria-label={`Tugas ${index + 1}`} placeholder="Tugas" value={item.task} onChange={(event) => patchAction(index, { task: event.target.value })} />
                <input className="bareInput" aria-label={`Penanggung jawab tugas ${index + 1}`} placeholder="Penanggung jawab" value={item.owner} onChange={(event) => patchAction(index, { owner: event.target.value })} />
                <input className="bareInput" aria-label={`Tenggat tugas ${index + 1}`} placeholder="Tenggat" value={item.due} onChange={(event) => patchAction(index, { due: event.target.value })} />
                <button type="button" className="iconButton danger" onClick={() => setActions((items) => items.filter((_, i) => i !== index))} aria-label={`Hapus tugas ${index + 1}`}>
                  <Trash2 size={18} strokeWidth={1.75} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="stack" aria-labelledby="e-rangkuman">
        <h2 id="e-rangkuman" className="sectionTitle">
          Rangkuman
        </h2>
        <Textarea label="Rangkuman" rows={4} value={summary} onChange={(event) => setSummary(event.target.value)} />
      </section>

      <div className="formActions">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Batal
        </Button>
        <Button type="submit" className="tone-blue" loading={saving}>
          Simpan notulen
        </Button>
      </div>
    </form>
  );
}
