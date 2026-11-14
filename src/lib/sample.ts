import { BRAND, hex } from "./brand";
import { todayISO } from "./format";
import { canvasToBlob } from "./images";
import { uid, type Meeting } from "./types";

/**
 * A made-up meeting, so the app can be explored (and the exports tried) before recording anything.
 * Every name and figure here is fictional.
 */
export function buildSampleMeeting(now = new Date()): Meeting {
  const stamp = now.getTime();
  const lines: [number, string, string][] = [
    [4, "Rina Wulandari", "Selamat pagi semuanya, terima kasih sudah bergabung. Hari ini kita koordinasi persiapan peluncuran aplikasi pemesanan versi dua. Agenda kita tiga: status pengembangan, rencana uji coba pengguna, dan jadwal peluncuran."],
    [31, "Bagus Pratama", "Dari tim pengembangan, fitur pembayaran dan riwayat pesanan sudah selesai. Yang masih berjalan adalah notifikasi, perkiraan saya selesai Rabu depan. Ada satu kendala, waktu muat halaman utama masih sekitar empat detik di ponsel kelas menengah."],
    [68, "Rina Wulandari", "Empat detik terlalu lama. Targetnya berapa?"],
    [74, "Bagus Pratama", "Target kita di bawah dua detik. Saya usul gambar produk dikompres dan daftar dimuat bertahap. Butuh kira-kira tiga hari kerja."],
    [96, "Sari Dewi", "Dari sisi desain saya setuju. Saya bisa siapkan ukuran gambar baru paling lambat Senin, supaya tim pengembangan tidak menunggu."],
    [118, "Andi Nugroho", "Untuk uji coba pengguna, saya sudah dapat dua belas calon peserta dari pelanggan lama. Saya usul uji coba dua hari, Kamis dan Jumat minggu depan, masing-masing enam orang."],
    [149, "Rina Wulandari", "Baik. Apakah dua belas orang cukup mewakili?"],
    [156, "Andi Nugroho", "Cukup untuk menemukan masalah utama. Kalau hasilnya banyak temuan, kita tambah satu putaran lagi dengan peserta baru."],
    [178, "Sari Dewi", "Saya minta skenario uji cobanya mencakup alur pembayaran, karena itu yang paling banyak berubah."],
    [192, "Rina Wulandari", "Setuju, masukkan alur pembayaran. Sekarang soal jadwal. Rencana awal peluncuran tanggal satu, tapi dengan perbaikan kecepatan dan uji coba, saya khawatir terlalu mepet."],
    [221, "Bagus Pratama", "Saya usul mundur satu minggu. Dengan begitu ada waktu memperbaiki temuan uji coba sebelum rilis."],
    [238, "Andi Nugroho", "Tim pemasaran bisa menyesuaikan, asal tanggal barunya pasti paling lambat akhir minggu ini karena materi promosi harus dicetak."],
    [259, "Rina Wulandari", "Kalau begitu kita putuskan: peluncuran mundur satu minggu menjadi tanggal delapan. Perbaikan kecepatan jadi prioritas pertama, dan uji coba pengguna jalan Kamis dan Jumat minggu depan."],
    [287, "Rina Wulandari", "Saya rangkum tindak lanjutnya. Bagus menyelesaikan notifikasi dan perbaikan kecepatan, Sari menyiapkan gambar hari Senin, Andi menyusun skenario dan mengundang peserta. Kita bertemu lagi Jumat depan untuk membahas hasil uji coba. Terima kasih semuanya."],
  ];

  return {
    id: uid(),
    title: "Koordinasi peluncuran aplikasi pemesanan versi 2",
    date: todayISO(now),
    startTime: "09:00",
    endTime: "09:35",
    platform: "teams",
    location: "Microsoft Teams, ruang Proyek Aplikasi",
    organizer: "Rina Wulandari",
    notetaker: "Notula",
    attendees: [
      { id: uid(), name: "Rina Wulandari", role: "Manajer produk", org: "Tim Produk", present: true },
      { id: uid(), name: "Bagus Pratama", role: "Pimpinan pengembangan", org: "Tim Teknologi", present: true },
      { id: uid(), name: "Sari Dewi", role: "Desainer produk", org: "Tim Desain", present: true },
      { id: uid(), name: "Andi Nugroho", role: "Riset dan pemasaran", org: "Tim Pemasaran", present: true },
      { id: uid(), name: "Dimas Saputra", role: "Dukungan pelanggan", org: "Tim Layanan", present: false },
    ],
    segments: lines.map(([start, speaker, text]) => ({ id: uid(), start, speaker, text })),
    minutes: {
      topic: "Koordinasi kesiapan peluncuran aplikasi pemesanan versi 2: status pengembangan, uji coba pengguna, dan jadwal rilis.",
      opening:
        "Rapat dibuka oleh Rina Wulandari selaku manajer produk. Ia menyampaikan tiga agenda: status pengembangan, rencana uji coba pengguna, dan jadwal peluncuran.",
      objectives: [
        "Mengetahui status terakhir pengembangan dan kendala yang tersisa",
        "Menyepakati rencana uji coba pengguna",
        "Memastikan jadwal peluncuran yang realistis",
      ],
      discussion: [
        {
          heading: "Status pengembangan dan kecepatan aplikasi",
          summary:
            "Fitur pembayaran dan riwayat pesanan sudah selesai, sedangkan notifikasi diperkirakan selesai Rabu depan. Kendala utama adalah waktu muat halaman utama yang masih sekitar empat detik di ponsel kelas menengah, dua kali lipat dari target.",
          points: [
            "Target waktu muat halaman utama di bawah dua detik",
            "Bagus mengusulkan kompresi gambar produk dan pemuatan daftar secara bertahap, perkiraan tiga hari kerja",
            "Sari menyiapkan ukuran gambar baru paling lambat Senin agar pengembangan tidak tertunda",
          ],
        },
        {
          heading: "Rencana uji coba pengguna",
          summary:
            "Andi sudah mendapatkan dua belas calon peserta dari pelanggan lama dan mengusulkan uji coba selama dua hari. Jumlah itu dinilai cukup untuk menemukan masalah utama, dengan opsi putaran tambahan bila temuannya banyak.",
          points: [
            "Uji coba Kamis dan Jumat minggu depan, enam peserta per hari",
            "Skenario wajib mencakup alur pembayaran karena paling banyak berubah",
            "Putaran tambahan dengan peserta baru bila temuan banyak",
          ],
        },
        {
          heading: "Jadwal peluncuran",
          summary:
            "Jadwal awal tanggal satu dinilai terlalu mepet karena ada perbaikan kecepatan dan uji coba. Bagus mengusulkan mundur satu minggu, dan tim pemasaran dapat menyesuaikan selama tanggal baru dipastikan paling lambat akhir minggu ini.",
          points: [
            "Mundur satu minggu memberi waktu memperbaiki temuan uji coba sebelum rilis",
            "Materi promosi harus dicetak, sehingga tanggal perlu segera pasti",
          ],
        },
      ],
      decisions: [
        "Peluncuran mundur satu minggu menjadi tanggal 8",
        "Perbaikan kecepatan halaman utama menjadi prioritas pertama",
        "Uji coba pengguna dilaksanakan Kamis dan Jumat minggu depan dengan 12 peserta",
      ],
      actionItems: [
        { task: "Menyelesaikan fitur notifikasi", owner: "Bagus Pratama", due: "Rabu depan" },
        { task: "Memperbaiki waktu muat halaman utama hingga di bawah dua detik", owner: "Bagus Pratama", due: "Sebelum uji coba" },
        { task: "Menyiapkan ukuran gambar produk yang baru", owner: "Sari Dewi", due: "Senin" },
        { task: "Menyusun skenario uji coba, termasuk alur pembayaran", owner: "Andi Nugroho", due: "Rabu depan" },
        { task: "Mengundang 12 peserta uji coba", owner: "Andi Nugroho", due: "Rabu depan" },
        { task: "Menginformasikan tanggal peluncuran baru ke tim pemasaran", owner: "Rina Wulandari", due: "Akhir minggu ini" },
      ],
      summary:
        "Pengembangan hampir selesai dengan satu kendala kecepatan yang akan diperbaiki lebih dulu. Uji coba pengguna berjalan minggu depan, dan peluncuran disepakati mundur satu minggu menjadi tanggal 8. Rapat berikutnya Jumat depan untuk membahas hasil uji coba.",
      generatedAt: stamp,
      source: "manual",
    },
    durationSec: 35 * 60,
    language: "id",
    createdAt: stamp,
    updatedAt: stamp,
    isSample: true,
  };
}

export const SAMPLE_IMAGE_CAPTION = "Sketsa jadwal di papan tulis: perbaikan kecepatan, uji coba pengguna, lalu peluncuran tanggal 8.";

/** A small whiteboard-style sketch of the launch timeline, so the sample has a picture to show. */
export async function drawSampleImage(): Promise<{ blob: Blob; width: number; height: number }> {
  const width = 1200;
  const height = 675;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Gambar contoh tidak bisa dibuat.");

  ctx.fillStyle = "#fbfbf8";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = hex(BRAND.border);
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, width - 10, height - 10);

  ctx.fillStyle = hex(BRAND.ink);
  ctx.font = '500 44px "Geist Variable", system-ui, sans-serif';
  ctx.fillText("Jadwal menuju peluncuran", 70, 110);

  const steps: [string, string, string][] = [
    ["Senin", "Gambar baru siap", BRAND.blue],
    ["Rabu", "Notifikasi selesai", BRAND.blue],
    ["Kamis, Jumat", "Uji coba pengguna", BRAND.orange],
    ["Tanggal 8", "Peluncuran", BRAND.orange],
  ];
  const y = 330;
  const startX = 150;
  const stepGap = (width - startX * 2) / (steps.length - 1);
  ctx.strokeStyle = hex(BRAND.ink);
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(startX, y);
  ctx.lineTo(width - startX, y);
  ctx.stroke();

  steps.forEach(([when, what, color], index) => {
    const x = startX + stepGap * index;
    ctx.beginPath();
    ctx.arc(x, y, 26, 0, Math.PI * 2);
    ctx.fillStyle = hex(color);
    ctx.fill();
    ctx.textAlign = "center";
    ctx.fillStyle = hex(BRAND.ink);
    ctx.font = '500 30px "Inter Variable", system-ui, sans-serif';
    ctx.fillText(when, x, y - 60);
    ctx.fillStyle = hex(BRAND.textSecondary);
    ctx.font = '400 26px "Inter Variable", system-ui, sans-serif';
    ctx.fillText(what, x, y + 80);
  });
  ctx.textAlign = "left";

  ctx.fillStyle = hex(BRAND.orangeStrong);
  ctx.font = '500 30px "Inter Variable", system-ui, sans-serif';
  ctx.fillText("Target waktu muat: di bawah 2 detik", 70, 560);

  const blob = await canvasToBlob(canvas, "image/jpeg", 0.9);
  return { blob, width, height };
}
