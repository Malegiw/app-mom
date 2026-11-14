# Notula by YMD

Notula mencatat hasil rapat, baik rapat online (Microsoft Teams, Zoom, Google Meet) maupun tatap muka. Hasilnya berupa transkrip dan notulen yang berisi tulisan dan gambar, lalu bisa diekspor ke Word, Excel, dan PowerPoint.

Notula adalah aplikasi web yang bisa dipasang (PWA), jadi satu aplikasi yang sama berjalan di ponsel, iPad atau tablet, dan komputer.

Buka aplikasinya: <https://malegiw.github.io/app-mom/>

## Yang bisa dilakukan

- **Merekam rapat** lewat mikrofon, dengan transkrip langsung selama rapat berjalan.
- **Merekam audio rapat online** di komputer: suara tab atau jendela Teams, Zoom, atau Meet digabung dengan mikrofon.
- **Mengimpor transkrip** dari Teams, Zoom, atau Meet (`.vtt`, `.docx`, `.srt`, `.txt`), atau menempel teks.
- **Mentranskripsikan rekaman** audio dan video menjadi teks dengan label pembicara (butuh kunci ElevenLabs).
- **Menyusun notulen otomatis** dengan Claude: topik dan pembukaan, tujuan, isi pembahasan, keputusan, tindak lanjut, rangkuman, dan daftar hadir lewat langganan Claude Anda (salin prompt ke claude.ai, tempel jawabannya) atau otomatis dengan kunci API.
- **Menulis atau mengubah notulen sendiri**, tanpa kunci API apa pun.
- **Menambahkan gambar**: foto papan tulis, slide, atau tangkapan layar. Notula juga menggambar satu halaman ringkasan visual.
- **Mengekspor** ke Word (`.docx`), Excel (`.xlsx`), dan PowerPoint (`.pptx`), lengkap dengan gambar, daftar hadir, dan transkrip.

## Menjalankan

Butuh Node.js 20 atau lebih baru.

```bash
npm install
npm run dev
```

Buka `http://localhost:5173`. Untuk mencoba tanpa merekam, pilih **Buka rapat contoh** di halaman awal.

Perintah lain:

| Perintah | Kegunaan |
| --- | --- |
| `npm run build` | Memeriksa tipe lalu membuat versi siap pasang di `dist/` |
| `npm run preview` | Menjalankan hasil build secara lokal |
| `npm test` | Menjalankan pengujian |
| `npm run typecheck` | Memeriksa tipe TypeScript |
| `npm run icons` | Membuat ulang ikon aplikasi |

## Kunci API

Kunci diisi di halaman **Pengaturan** dan hanya tersimpan di browser perangkat itu.

| Kunci | Dipakai untuk | Wajib? |
| --- | --- | --- |
| Claude (Anthropic) | Menyusun notulen otomatis penuh | Tidak. Tanpa kunci, pakai langganan Claude lewat salin-tempel |
| ElevenLabs | Mengubah rekaman audio atau video menjadi teks | Tidak |

Tanpa kunci apa pun, Notula tetap bisa menyusun notulen lewat langganan Claude (tanpa biaya tambahan), merekam, membuat transkrip langsung, mengimpor transkrip, menulis notulen manual, dan mengekspor.

## Cara pakai untuk tiap jenis rapat

**Rapat tatap muka.** Buat rapat baru, pilih Rekam, lalu letakkan perangkat dekat para pembicara. Transkrip langsung berjalan selama rapat.

**Teams, Zoom, atau Meet di komputer.** Ada dua cara:

1. Paling akurat: nyalakan fitur transkrip bawaan Teams atau Zoom, unduh berkas transkripnya setelah rapat, lalu impor ke Notula. Nama pembicara ikut terbaca.
2. Rekam dari Notula dengan sumber suara "Audio rapat online dan mikrofon". Pilih tab atau jendela rapat dan centang berbagi audio. Rekaman lalu bisa ditranskripsikan dengan ElevenLabs.

**Rapat online di ponsel atau tablet.** Browser ponsel tidak bisa mengambil suara aplikasi lain. Gunakan pengeras suara dan rekam lewat mikrofon, atau impor transkrip setelah rapat.

## Privasi dan data

- Rapat, rekaman, dan gambar tersimpan di browser perangkat (IndexedDB). Tidak ada server Notula dan tidak ada sinkronisasi antar perangkat.
- Transkrip dan gambar dikirim ke Anthropic hanya saat notulen dibuat. Audio dikirim ke ElevenLabs hanya saat Anda menekan Transkripsikan atau mengimpor audio.
- Transkrip langsung memakai layanan suara bawaan browser. Di Chrome dan Edge, audio diproses di server pembuat browser.
- Menghapus data browser ikut menghapus rapat. Ekspor notulen yang penting.
- Minta persetujuan peserta sebelum merekam rapat.

## Batasan yang perlu diketahui

- Transkrip langsung tidak memberi label pembicara dan akurasinya bergantung pada browser. Gunakan Ganti nama pembicara atau transkripsi ElevenLabs untuk hasil yang lebih rapi.
- Transkrip langsung tidak tersedia di Firefox.
- Merekam audio rapat online hanya tersedia di browser komputer berbasis Chromium (Chrome, Edge).
- Kunci API tersimpan di browser tanpa enkripsi tambahan. Jangan isi kunci di perangkat bersama.

## Memasang di perangkat

Setelah aplikasi dipublikasikan di alamat HTTPS:

- iPhone dan iPad: buka di Safari, ketuk Bagikan, lalu Tambah ke Layar Utama.
- Android: buka di Chrome, ketuk menu, lalu Pasang aplikasi.
- Komputer: buka di Chrome atau Edge, lalu klik ikon pasang di bilah alamat.

## Publikasi ke GitHub Pages

Aplikasi terbit di <https://malegiw.github.io/app-mom/>. Setiap perubahan di cabang `main` dibangun dan diterbitkan otomatis oleh workflow `Deploy`.

Build memakai path relatif dan routing berbasis hash, jadi berjalan di alamat `https://<nama>.github.io/<repo>/` tanpa pengaturan tambahan. Untuk repo lain, nyalakan Pages lebih dulu di Settings > Pages dengan Source: GitHub Actions.

## Tampilan

Komponen antarmuka berasal dari [Arc](https://uiarc.dev), dipasang lewat MCP dan shadcn CLI ke `src/components/arc/`. Palet warnanya putih, biru, dan oranye dengan acuan Pantone:

| Warna | Acuan Pantone | Hex |
| --- | --- | --- |
| Putih | 11-0601 TCX Bright White | `#F4F5F0` |
| Biru | 19-4052 TCX Classic Blue | `#0F4C81` |
| Oranye | Orange 021 C | `#FE5000` |

Nilai hex adalah pendekatan sRGB dari tiap warna. Token warna ada di `src/styles/theme.css`, dan salinannya untuk ekspor di `src/lib/brand.ts`.

## Susunan kode

```
src/
  components/arc/      Komponen Arc (tombol, dialog, tab, dropzone, dan lainnya)
  components/meeting/  Ruang kerja rapat: perekam, transkrip, notulen, peserta, gambar, ekspor
  pages/               Beranda, rapat, pengaturan
  lib/
    recorder.ts        Perekaman mikrofon dan audio rapat online
    speech.ts          Transkrip langsung dari browser
    stt.ts             Transkripsi rekaman lewat ElevenLabs Scribe
    transcript.ts      Pembaca VTT, SRT, Word, dan teks biasa
    summarize.ts       Penyusunan notulen dengan Claude
    visual.ts          Gambar ringkasan visual
    export/            Pembuat berkas Word, Excel, dan PowerPoint
    db.ts              Penyimpanan lokal (IndexedDB lewat Dexie)
tests/                 Pengujian pembaca transkrip, ekspor, dan permintaan ke Claude
```

Teknologi: React, TypeScript, Vite, Dexie, `@anthropic-ai/sdk`, `docx`, `exceljs`, `pptxgenjs`, dan `vite-plugin-pwa`.
