import { useState } from "react";
import { exportMeeting, EXPORT_INFO, type ExportKind } from "@/lib/export";
import { getSettings } from "@/lib/settings";
import type { Meeting } from "@/lib/types";

type ExportState = { status: "idle" } | { status: "working" } | { status: "done"; fileName: string } | { status: "error"; message: string };

const KINDS: { kind: ExportKind; mark: string; orange?: boolean }[] = [
  { kind: "docx", mark: "DOC" },
  { kind: "xlsx", mark: "XLS" },
  { kind: "pptx", mark: "PPT", orange: true },
];

/** Runs one export and reports where it stands, shared by the cards below and the header menu. */
export function useExporter(meeting: Meeting) {
  const [states, setStates] = useState<Record<ExportKind, ExportState>>({ docx: { status: "idle" }, xlsx: { status: "idle" }, pptx: { status: "idle" } });

  async function run(kind: ExportKind) {
    setStates((current) => ({ ...current, [kind]: { status: "working" } }));
    try {
      const fileName = await exportMeeting(kind, meeting, getSettings().organization);
      setStates((current) => ({ ...current, [kind]: { status: "done", fileName } }));
      return fileName;
    } catch (cause) {
      const message = cause instanceof Error && cause.message ? cause.message : "Berkas gagal dibuat.";
      setStates((current) => ({ ...current, [kind]: { status: "error", message } }));
      return null;
    }
  }

  return { states, run };
}

export function ExportPanel({ meeting }: { meeting: Meeting }) {
  const { states, run } = useExporter(meeting);

  return (
    <div className="exports">
      {KINDS.map(({ kind, mark, orange }) => {
        const state = states[kind];
        const info = EXPORT_INFO[kind];
        return (
          <button key={kind} type="button" className="exportCard" onClick={() => void run(kind)} disabled={state.status === "working"} aria-busy={state.status === "working"}>
            <span className={orange ? "fileMark orange" : "fileMark"} aria-hidden="true">
              {mark}
            </span>
            <strong>{state.status === "working" ? `Menyiapkan ${info.label}` : `Unduh ${info.label}`}</strong>
            <small role="status">
              {state.status === "done" ? `Tersimpan: ${state.fileName}` : state.status === "error" ? `Gagal: ${state.message}` : info.description}
            </small>
          </button>
        );
      })}
    </div>
  );
}
