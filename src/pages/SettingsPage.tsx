import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Badge } from "@/components/arc/badge/badge";
import { Button } from "@/components/arc/button/button";
import { ConfirmMorph } from "@/components/arc/confirm-morph/confirm-morph";
import { Input } from "@/components/arc/input/input";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { Select } from "@/components/arc/select/select";
import { Switch } from "@/components/arc/switch/switch";
import { LANGUAGE_OPTIONS } from "@/components/NewMeetingDialog";
import { db, deleteEverything } from "@/lib/db";
import { enginePairing, refreshEngine, useEngine, type EngineInfo } from "@/lib/engine";
import { ENGINE_MODEL_OPTIONS, MODEL_OPTIONS, saveSettings, useSettings } from "@/lib/settings";
import type { Lang } from "@/lib/types";

const percent = (share: number | null) => (share === null ? "" : `${Math.round(share * 100)}%`);
const capitalize = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);

function engineLabel(engine: EngineInfo): { tone: "success" | "warning" | "neutral"; text: string } {
  if (engine.state === "ready") return { tone: "success", text: "Terhubung" };
  if (engine.state === "needs-code") return { tone: "warning", text: "Butuh kode akses" };
  if (engine.state === "checking") return { tone: "neutral", text: "Memeriksa" };
  return { tone: "neutral", text: "Belum terhubung" };
}

export function SettingsPage() {
  const settings = useSettings();
  const engine = useEngine();
  const count = useLiveQuery(() => db.meetings.count(), []) ?? 0;
  const [checking, setChecking] = useState(false);
  const [pairing, setPairing] = useState<{ enabled: boolean; code: string; urls: string[] } | null>(null);
  const status = engineLabel(engine);
  const ready = engine.state === "ready";
  // On the engine's own computer the page is opened from localhost. Anywhere else it is a phone, tablet, or the published site.
  const onEngineComputer = ["localhost", "127.0.0.1"].includes(window.location.hostname);

  useEffect(() => {
    let cancelled = false;
    if (ready && onEngineComputer) void enginePairing().then((result) => !cancelled && setPairing(result));
    else setPairing(null);
    return () => {
      cancelled = true;
    };
  }, [ready, onEngineComputer, engine.lan]);

  async function recheck() {
    setChecking(true);
    await refreshEngine();
    setChecking(false);
  }

  return (
    <main className="page narrow">
      <div>
        <h1 className="pageTitle">Pengaturan</h1>
        <p className="lede">Pengaturan tersimpan hanya di perangkat ini.</p>
      </div>

      <section className="settingsSection" aria-labelledby="s-mesin">
        <div className="sectionHead">
          <h2 id="s-mesin" className="sectionTitle">
            Mesin Notula
          </h2>
          <Button variant="secondary" size="sm" onClick={() => void recheck()} loading={checking}>
            Periksa lagi
          </Button>
        </div>
        <p>
          Mesin adalah program kecil di komputer Anda. Ia mengubah suara menjadi teks dengan Whisper dan meminta Claude Code menyusun notulen beserta gambarnya, memakai langganan Claude Anda. Tidak ada
          kunci API dan tidak ada biaya di luar langganan.
        </p>

        <div className="group">
          <div className="optionRow">
            <div className="optionText">
              <strong>Mesin</strong>
              <p>
                {ready
                  ? `Versi ${engine.version}${engine.base ? `, di ${engine.base}` : ""}`
                  : engine.state === "needs-code"
                    ? "Mesin ditemukan. Isi kode akses di bawah untuk memakainya dari perangkat ini."
                    : "Di komputer, jalankan npm start di folder proyek, lalu buka http://localhost:8787."}
              </p>
            </div>
            <Badge tone={status.tone}>{status.text}</Badge>
          </div>
          {ready ? (
            <>
              <div className="optionRow">
                <div className="optionText">
                  <strong>Transkripsi di komputer</strong>
                  <p>{engine.whisper ? "Whisper siap. Suara tidak dikirim ke layanan mana pun." : "Whisper atau modelnya belum terpasang di komputer mesin."}</p>
                </div>
                <Badge tone={engine.whisper ? "success" : "warning"}>{engine.whisper ? "Siap" : "Belum siap"}</Badge>
              </div>
              <div className="optionRow">
                <div className="optionText">
                  <strong>Claude Code</strong>
                  <p>
                    {!engine.claude.installed
                      ? "Claude Code belum terpasang di komputer mesin."
                      : engine.claude.loggedIn
                        ? `Masuk dengan langganan${engine.claude.plan ? ` ${capitalize(engine.claude.plan)}` : ""}.`
                        : "Belum masuk. Di Terminal, jalankan claude lalu ketik /login."}
                  </p>
                  {engine.usage && (engine.usage.fiveHour !== null || engine.usage.sevenDay !== null) ? (
                    <p style={{ fontVariantNumeric: "tabular-nums" }}>
                      Kuota terpakai: {percent(engine.usage.fiveHour)} dari jatah 5 jam, {percent(engine.usage.sevenDay)} dari jatah 7 hari.
                    </p>
                  ) : null}
                </div>
                <Badge tone={engine.claude.loggedIn ? "success" : "warning"}>{engine.claude.loggedIn ? "Siap" : "Belum siap"}</Badge>
              </div>
            </>
          ) : null}
        </div>

        <Select label="Model Claude untuk notulen" options={ENGINE_MODEL_OPTIONS} value={settings.engineModel || "default"} onValueChange={(engineModel) => saveSettings({ engineModel })} />
        <div className="group">
          <div className="optionRow">
            <div className="optionText">
              <strong id="set-auto">Notulen otomatis</strong>
              <p>Begitu selesai mendengarkan, Claude langsung menyusun notulen.</p>
            </div>
            <Switch aria-labelledby="set-auto" checked={settings.autoMinutes} onCheckedChange={(autoMinutes) => saveSettings({ autoMinutes })} />
          </div>
          <div className="optionRow">
            <div className="optionText">
              <strong id="set-visual">Gambar buatan Claude</strong>
              <p>Claude menggambar diagram dan infografik untuk notulen.</p>
            </div>
            <Switch aria-labelledby="set-visual" checked={settings.makeVisuals} onCheckedChange={(makeVisuals) => saveSettings({ makeVisuals })} />
          </div>
        </div>
        <div className="labeled">
          <span>Bahasa notulen</span>
          <div>
            <SegmentedControl label="Bahasa notulen" options={LANGUAGE_OPTIONS} value={settings.language} onValueChange={(language) => saveSettings({ language: language as Lang })} />
          </div>
        </div>
      </section>

      <section className="settingsSection" aria-labelledby="s-hp">
        <h2 id="s-hp" className="sectionTitle">
          HP dan iPad
        </h2>
        {onEngineComputer ? (
          pairing?.enabled ? (
            <>
              <p>Di HP atau iPad pada Wi-Fi yang sama, buka salah satu alamat ini lalu masukkan kode aksesnya di Pengaturan.</p>
              <div className="group">
                {pairing.urls.map((url) => (
                  <div key={url} className="optionRow">
                    <code>{url}</code>
                  </div>
                ))}
                <div className="optionRow">
                  <div className="optionText">
                    <strong>Kode akses</strong>
                    <p>Hanya perangkat yang tahu kode ini yang bisa memakai mesin.</p>
                  </div>
                  <code>{pairing.code}</code>
                </div>
              </div>
            </>
          ) : (
            <p>
              Agar HP dan iPad di Wi-Fi yang sama bisa memakai mesin ini, jalankan mesin dengan <code>npm run start:lan</code>. Alamat dan kode aksesnya akan muncul di sini.
            </p>
          )
        ) : (
          <Input
            label="Kode akses mesin"
            description="Kode ini tampil di Pengaturan pada komputer mesin."
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={settings.engineCode}
            onChange={(event) => saveSettings({ engineCode: event.target.value.trim().toUpperCase() })}
            onBlur={() => void refreshEngine()}
          />
        )}
        <Input
          label="Alamat mesin (opsional)"
          description="Kosongkan untuk mencari otomatis."
          placeholder="http://127.0.0.1:8787"
          autoComplete="off"
          spellCheck={false}
          value={settings.engineUrl}
          onChange={(event) => saveSettings({ engineUrl: event.target.value.trim() })}
          onBlur={() => void refreshEngine()}
        />
      </section>

      <section className="settingsSection" aria-labelledby="s-claude">
        <h2 id="s-claude" className="sectionTitle">
          Tanpa mesin
        </h2>
        <p>
          Bila mesin tidak terhubung, notulen tetap bisa dibuat lewat langganan Claude dengan cara salin-tempel ke claude.ai di tab Notulen. Pilihan lain adalah kunci API, yang ditagih terpisah dari
          langganan.
        </p>
        <Input
          label="Kunci API Claude (opsional)"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="sk-ant-..."
          value={settings.anthropicKey}
          onChange={(event) => saveSettings({ anthropicKey: event.target.value.trim() })}
        />
        <Select label="Model untuk kunci API" options={MODEL_OPTIONS} value={settings.model} onValueChange={(model) => saveSettings({ model })} />
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
