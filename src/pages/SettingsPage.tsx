import { useLiveQuery } from "dexie-react-hooks";
import { ConfirmMorph } from "@/components/arc/confirm-morph/confirm-morph";
import { Input } from "@/components/arc/input/input";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { Select } from "@/components/arc/select/select";
import { LANGUAGE_OPTIONS } from "@/components/NewMeetingDialog";
import { db, deleteEverything } from "@/lib/db";
import { MODEL_OPTIONS, saveSettings, useSettings } from "@/lib/settings";
import type { Lang } from "@/lib/types";

export function SettingsPage() {
  const settings = useSettings();
  const count = useLiveQuery(() => db.meetings.count(), []) ?? 0;

  return (
    <main className="page narrow">
      <div>
        <h1 className="pageTitle">Pengaturan</h1>
        <p className="lede">Semua pengaturan dan kunci API tersimpan hanya di perangkat ini.</p>
      </div>

      <section className="settingsSection" aria-labelledby="s-claude">
        <h2 id="s-claude" className="sectionTitle">
          Notulen otomatis
        </h2>
        <p>
          Notula memakai Claude untuk merangkum transkrip menjadi notulen. Buat kunci API di{" "}
          <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">
            platform.claude.com
          </a>
          . Kunci hanya dikirim ke Anthropic saat notulen dibuat.
        </p>
        <Input
          label="Kunci API Claude"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="sk-ant-..."
          value={settings.anthropicKey}
          onChange={(event) => saveSettings({ anthropicKey: event.target.value.trim() })}
        />
        <Select label="Model" options={MODEL_OPTIONS} value={settings.model} onValueChange={(model) => saveSettings({ model })} />
        <div className="labeled">
          <span>Bahasa notulen</span>
          <div>
            <SegmentedControl label="Bahasa notulen" options={LANGUAGE_OPTIONS} value={settings.language} onValueChange={(language) => saveSettings({ language: language as Lang })} />
          </div>
        </div>
      </section>

      <section className="settingsSection" aria-labelledby="s-stt">
        <h2 id="s-stt" className="sectionTitle">
          Transkripsi rekaman audio
        </h2>
        <p>
          Transkrip langsung saat merekam dan impor transkrip Teams atau Zoom tidak butuh kunci apa pun. Kunci ElevenLabs hanya diperlukan untuk mengubah rekaman audio atau video menjadi teks dengan
          label pembicara. Buat kunci di{" "}
          <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noreferrer">
            elevenlabs.io
          </a>
          .
        </p>
        <Input
          label="Kunci API ElevenLabs (opsional)"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={settings.elevenLabsKey}
          onChange={(event) => saveSettings({ elevenLabsKey: event.target.value.trim() })}
        />
      </section>

      <section className="settingsSection" aria-labelledby="s-dokumen">
        <h2 id="s-dokumen" className="sectionTitle">
          Dokumen
        </h2>
        <p>Tampil di kepala berkas Word, Excel, dan PowerPoint.</p>
        <Input label="Nama organisasi" value={settings.organization} onChange={(event) => saveSettings({ organization: event.target.value })} />
        <Input label="Nama notulis" description="Dipakai sebagai notulis untuk rapat baru." value={settings.notetaker} onChange={(event) => saveSettings({ notetaker: event.target.value })} />
      </section>

      <section className="settingsSection" aria-labelledby="s-pasang">
        <h2 id="s-pasang" className="sectionTitle">
          Pasang di perangkat
        </h2>
        <p>Notula bisa dipasang seperti aplikasi biasa dan tetap terbuka tanpa internet. Merekam dan membaca rapat berjalan offline, sedangkan notulen otomatis butuh koneksi.</p>
        <ol className="steps">
          <li>iPhone dan iPad: buka di Safari, ketuk Bagikan, lalu Tambah ke Layar Utama.</li>
          <li>Android: buka di Chrome, ketuk menu, lalu Pasang aplikasi.</li>
          <li>Komputer: buka di Chrome atau Edge, lalu klik ikon pasang di bilah alamat.</li>
        </ol>
      </section>

      <section className="settingsSection" aria-labelledby="s-data">
        <h2 id="s-data" className="sectionTitle">
          Data
        </h2>
        <p>
          {count > 0 ? `${count} rapat tersimpan di browser perangkat ini.` : "Belum ada rapat yang tersimpan."} Data tidak disinkronkan ke perangkat lain. Menghapus data browser juga menghapus
          rapat, jadi ekspor notulen yang penting.
        </p>
        {count > 0 ? (
          <div>
            <ConfirmMorph label="Hapus semua rapat" prompt={`Hapus ${count} rapat selamanya?`} confirmLabel="Tahan untuk menghapus" confirmMode="hold" onConfirm={() => deleteEverything()} />
          </div>
        ) : null}
      </section>
    </main>
  );
}
