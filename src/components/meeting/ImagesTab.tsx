import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Trash2 } from "lucide-react";
import { FileDropzone, type FileDropzoneUpload } from "@/components/arc/file-dropzone/file-dropzone";
import { addAsset, deleteAsset, listAssets, updateAsset } from "@/lib/db";
import { normalizeImage } from "@/lib/images";
import type { Asset, Meeting } from "@/lib/types";

/** Pictures from the meeting: whiteboard photos, slides, screenshots. They go into the minutes and every export. */
export function ImagesTab({ meeting }: { meeting: Meeting }) {
  const images = useLiveQuery(() => listAssets(meeting.id, "image"), [meeting.id]) ?? [];
  // The dropzone keeps its own list of what was just added. The gallery below is the real list, so
  // once a batch has landed the dropzone starts fresh.
  const [batch, setBatch] = useState(0);
  const pending = useRef(0);
  const resetTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  const upload: FileDropzoneUpload = async (item, { onProgress }) => {
    if (!item.file) throw new Error("Berkas tidak terbaca.");
    pending.current += 1;
    window.clearTimeout(resetTimer.current);
    try {
      onProgress(20);
      const picture = await normalizeImage(item.file);
      onProgress(70);
      await addAsset({
        meetingId: meeting.id,
        kind: "image",
        name: item.file.name.replace(/\.[^.]+$/, "") + ".jpg",
        mime: "image/jpeg",
        blob: picture.blob,
        caption: "",
        width: picture.width,
        height: picture.height,
      });
      onProgress(100);
    } finally {
      pending.current -= 1;
      if (pending.current === 0) resetTimer.current = window.setTimeout(() => setBatch((value) => value + 1), 2500);
    }
  };

  return (
    <div className="stack loose">
      <FileDropzone
        key={batch}
        accept="image/*"
        maxFiles={12}
        label="Tambah gambar"
        description="Foto papan tulis, slide, atau tangkapan layar"
        note="Di ponsel dan tablet, Anda bisa langsung memotret"
        onUpload={upload}
      />

      {images.length > 0 ? (
        <section className="stack" aria-labelledby="galeri">
          <div>
            <h2 id="galeri" className="sectionTitle">
              Gambar rapat
            </h2>
            <p className="muted small">Keterangan ikut tampil di notulen dan ekspor. Yang kosong diisi otomatis saat notulen dibuat.</p>
          </div>
          <div className="gallery">
            {images.map((image, index) => (
              <EditableFigure key={image.id} image={image} index={index} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function EditableFigure({ image, index }: { image: Asset; index: number }) {
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState(image.caption);
  const focused = useRef(false);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(image.blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [image.blob]);

  // A caption written by the summary shows up here, unless this field is being typed in.
  useEffect(() => {
    if (!focused.current) setCaption(image.caption);
  }, [image.caption]);

  return (
    <figure className="figure">
      {url ? <img src={url} alt={caption || image.name} loading="lazy" /> : <div className="visual" style={{ aspectRatio: "4 / 3" }} />}
      <div className="figureTools">
        <textarea
          className="bareTextarea"
          style={{ minHeight: 64 }}
          rows={2}
          aria-label={`Keterangan gambar ${index + 1}`}
          placeholder="Keterangan gambar"
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={() => {
            focused.current = false;
            if (caption.trim() !== image.caption) void updateAsset(image.id, { caption: caption.trim() });
          }}
        />
        <button type="button" className="iconButton danger" onClick={() => void deleteAsset(image.id)} aria-label={`Hapus gambar ${index + 1}`}>
          <Trash2 size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
    </figure>
  );
}
