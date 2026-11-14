import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSampleMeeting } from "../src/lib/sample";
import { generateMinutes, SummaryError, toMinutes } from "../src/lib/summarize";

/**
 * These tests stand in for the Claude API with a recorded-shape streaming response, so they check
 * what Notula sends and how it reads the answer without spending tokens. They do not prove the
 * live API accepts the request.
 */
const answer = {
  title: "Koordinasi peluncuran aplikasi",
  topic: "Kesiapan peluncuran",
  opening: "Rapat dibuka oleh Rina.",
  objectives: ["Menyepakati jadwal", "  "],
  discussion: [{ heading: "Jadwal", summary: "Peluncuran mundur.", points: ["Mundur satu minggu"] }],
  decisions: ["Peluncuran tanggal 8"],
  actionItems: [
    { task: "Kirim jadwal baru", owner: "Rina", due: "Jumat" },
    { task: "", owner: "", due: "" },
  ],
  summary: "Peluncuran disepakati mundur.",
  attendees: [{ name: "Rina Wulandari", role: "Manajer produk" }],
  imageCaptions: [{ index: 1, caption: "Sketsa jadwal." }],
};

function sse(events: [string, object][]): Response {
  const body = events.map(([type, data]) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function streamOf(text: string, stopReason = "end_turn"): Response {
  const half = Math.floor(text.length / 2);
  return sse([
    ["message_start", { message: { id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }],
    ["content_block_start", { index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { index: 0, delta: { type: "text_delta", text: text.slice(0, half) } }],
    ["content_block_delta", { index: 0, delta: { type: "text_delta", text: text.slice(half) } }],
    ["content_block_stop", { index: 0 }],
    ["message_delta", { delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 50 } }],
    ["message_stop", {}],
  ]);
}

const options = (overrides: Partial<Parameters<typeof generateMinutes>[0]> = {}) => ({
  apiKey: "test-key-not-real",
  model: "claude-opus-5-5",
  language: "id" as const,
  meeting: buildSampleMeeting(new Date(2026, 10, 14)),
  images: [{ base64: "AAAA" }],
  ...overrides,
});

afterEach(() => vi.unstubAllGlobals());

describe("generateMinutes", () => {
  it("sends the transcript, pictures, schema, and fallback opt-in, then reads the streamed answer", async () => {
    const calls: { url: string; headers: Headers; body: Record<string, any> }[] = [];
    const progress: number[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
      return streamOf(JSON.stringify(answer));
    });

    const result = await generateMinutes(options({ onProgress: (n) => progress.push(n) }));

    expect(calls).toHaveLength(1);
    const { url, headers, body } = calls[0];
    expect(url).toContain("/v1/messages");
    // SDK 1.x on API version 2026-10-21 sends the key as a bearer token.
    expect(headers.get("authorization")).toBe("Bearer test-key-not-real");
    expect(headers.get("anthropic-dangerous-direct-browser-access")).toBe("true");
    expect(headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.stream).toBe(true);
    expect(body.fallbacks).toBe("default");
    expect(body.thinking).toBeUndefined();
    expect(body.temperature).toBeUndefined();
    expect(body.output_config.effort).toBe("medium");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.output_config.format.schema.required).toContain("actionItems");
    expect(body.output_config.format.schema.additionalProperties).toBe(false);
    expect(body.system).toContain("Bahasa Indonesia");

    const content = body.messages[0].content;
    expect(content[0]).toEqual({ type: "text", text: "Picture 1:" });
    expect(content[1]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } });
    const brief = content[content.length - 1].text as string;
    expect(brief).toContain("<transcript>");
    expect(brief).toContain("[00:04] Rina Wulandari: Selamat pagi semuanya");
    expect(brief).toContain("Rina Wulandari (Manajer produk)");
    expect(brief).toContain("Pictures attached: 1");

    expect(result.title).toBe("Koordinasi peluncuran aplikasi");
    expect(progress.at(-1)).toBe(JSON.stringify(answer).length);

    const minutes = toMinutes(result, "claude-opus-5-5");
    expect(minutes.objectives).toEqual(["Menyepakati jadwal"]);
    expect(minutes.actionItems).toEqual([{ task: "Kirim jadwal baru", owner: "Rina", due: "Jumat" }]);
    expect(minutes.source).toBe("ai");
  });

  it("leaves the fallback opt-in off for Haiku, which has no server-side fallback", async () => {
    let seen: { headers: Headers; body: Record<string, any> } | null = null;
    vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen = { headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) };
      return streamOf(JSON.stringify(answer));
    });
    await generateMinutes(options({ model: "claude-haiku-5-5", images: [] }));
    expect(seen!.body.fallbacks).toBeUndefined();
    expect(seen!.headers.get("anthropic-beta") ?? "").not.toContain("server-side-fallback");
    expect(seen!.body.messages[0].content).toHaveLength(1);
  });

  it("explains a rejected API key", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }), { status: 401, headers: { "content-type": "application/json" } }));
    await expect(generateMinutes(options())).rejects.toThrow(/Kunci API Claude tidak valid/);
  });

  it("reports a refusal and a cut-off answer instead of returning broken minutes", async () => {
    vi.stubGlobal("fetch", async () => streamOf("", "refusal"));
    await expect(generateMinutes(options())).rejects.toThrow(/menolak/);
    vi.stubGlobal("fetch", async () => streamOf('{"title": "terpot', "max_tokens"));
    await expect(generateMinutes(options())).rejects.toThrow(/terpotong/);
  });

  it("stops before calling the API when there is no key or no transcript", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(generateMinutes(options({ apiKey: "" }))).rejects.toBeInstanceOf(SummaryError);
    const empty = buildSampleMeeting();
    empty.segments = [];
    await expect(generateMinutes(options({ meeting: empty }))).rejects.toThrow(/Transkrip masih kosong/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
