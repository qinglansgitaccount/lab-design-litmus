"use client";
import { useState, useRef, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type DataEntry = {
  id: string;
  field_name: string;
  field_value: string;
  unit: string;
  source: string;
  created_at: string;
  raw_transcript: string;
};

type SubExperiment = {
  id: string;
  name: string;
  fields: string[];
};

type ExtractedValue = {
  field_name: string;
  field_value: string;
  unit: string;
};

export default function ExperimentPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const experimentId = params.id as string;

  const subExperiments: SubExperiment[] = JSON.parse(
    decodeURIComponent(searchParams.get("subs") || "[]")
  );
  const [activeSubId, setActiveSubId] = useState(subExperiments[0]?.id || "");
  const activeSub = subExperiments.find(s => s.id === activeSubId);

  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [entries, setEntries] = useState<DataEntry[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [extracted, setExtracted] = useState<ExtractedValue[]>([]);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageStatus, setImageStatus] = useState("");
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!activeSubId) return;

    const loadEntries = async () => {
      const { data } = await supabase
        .from("data_entries")
        .select("*")
        .eq("sub_experiment_id", activeSubId)
        .order("created_at", { ascending: false });
      if (data) setEntries(data);
    };
    loadEntries();

    const channel = supabase
      .channel(`entries_${activeSubId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "data_entries",
          filter: `sub_experiment_id=eq.${activeSubId}`
        },
        (payload) => {
          setEntries(prev => [payload.new as DataEntry, ...prev]);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [activeSubId]);

  const toggleRecording = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      setLoading(true);
    } else {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => chunksRef.current.push(e.data);
      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        await processAudio(blob);
        stream.getTracks().forEach(t => t.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setStatus("");
      setTranscript("");
    }
  };

  const processAudio = async (blob: Blob) => {
    try {
      setStatus("Transcribing...");
      const formData = new FormData();
      formData.append("audio", blob, "recording.webm");
      const transcribeRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/transcribe`, {
        method: "POST",
        body: formData,
      });
      const transcribeData = await transcribeRes.json();
      const text = transcribeData.text;
      setTranscript(text);

      setStatus("Thinking...");
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: text,
          experiment_id: experimentId,
          active_sub_experiment_id: activeSubId,
          sub_experiments: subExperiments
        }),
      });
      setStatus("Done ✓");
    } catch (e) {
      setStatus("Error — check if backend is running");
    } finally {
      setLoading(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImageLoading(true);
    setImageStatus("Analyzing image...");
    setExtracted([]);

    try {
      const formData = new FormData();
      formData.append("image", file);
      formData.append("sub_experiment_id", activeSubId);
      formData.append("fields", activeSub?.fields.join(",") || "");

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/vision/extract`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      setExtracted(data.extracted);
      setImageStatus(data.extracted.length > 0 ? "Review and confirm values" : "No values detected");
    } catch (e) {
      setImageStatus("Error analyzing image");
    } finally {
      setImageLoading(false);
    }
  };

  const confirmValue = async (value: ExtractedValue) => {
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/vision/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sub_experiment_id: activeSubId,
        field_name: value.field_name,
        field_value: value.field_value,
        unit: value.unit,
      }),
    });
    setExtracted(prev => prev.filter(v => v !== value));
  };

  const confirmAll = async () => {
    for (const value of extracted) await confirmValue(value);
  };

  const formatTime = (ts: string) =>
    new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <main className="min-h-screen bg-white flex flex-col">

      {/* Top bar */}
      <header className="border-b border-gray-100 px-8 py-4 flex items-center justify-between">
        <button
          onClick={() => router.push("/")}
          className="flex items-center gap-3 hover:opacity-70 transition-opacity"
        >
          <div className="w-6 h-6 rounded-full border-2 border-gray-900" />
          <span className="font-mono text-sm font-medium tracking-widest uppercase text-gray-900">
            Lab Copilot
          </span>
        </button>
        <div className="flex items-center gap-6">
          {/* Sub-experiment tabs */}
          {subExperiments.length > 1 && (
            <div className="flex gap-1">
              {subExperiments.map(sub => (
                <button
                  key={sub.id}
                  onClick={() => setActiveSubId(sub.id)}
                  className={`px-3 py-1.5 text-xs font-mono tracking-wide transition-colors ${
                    activeSubId === sub.id
                      ? "bg-gray-900 text-white"
                      : "text-gray-500 hover:text-gray-900 border border-gray-200 hover:border-gray-400"
                  }`}
                >
                  {sub.name}
                </button>
              ))}
            </div>
          )}
          <span className="font-mono text-xs text-gray-400 tracking-wider">
            {activeSub?.name}
          </span>
        </div>
      </header>

      <section className="flex-1 flex flex-col items-center py-12 px-8">
        <div className="w-full max-w-2xl flex flex-col gap-8">

          {/* Fields */}
          {(activeSub?.fields?.length ?? 0) > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs text-gray-400 tracking-widest uppercase mr-2">
                Fields
              </span>
              {activeSub?.fields?.map(f => (
                <span key={f} className="font-mono text-xs border border-gray-200 px-2 py-1 text-gray-600">
                  {f}
                </span>
              ))}
            </div>
          )}

          {/* Record button */}
          <div className="flex flex-col items-center gap-4 py-8 border-y border-gray-100">
            <button
              onClick={toggleRecording}
              disabled={loading}
              className={`w-24 h-24 flex items-center justify-center border-2 text-2xl transition-all ${
                isRecording
                  ? "border-red-500 bg-red-50 text-red-500 scale-105"
                  : loading
                  ? "border-gray-200 text-gray-300 cursor-not-allowed"
                  : "border-gray-900 text-gray-900 hover:bg-gray-50"
              }`}
            >
              {isRecording ? "■" : "🎙"}
            </button>
            <div className="text-center">
              <p className="font-mono text-xs text-gray-400 tracking-wider">
                {isRecording ? "Recording — click to stop" : loading ? status : "Click to record"}
              </p>
              {transcript && !isRecording && (
                <p className="text-sm text-gray-600 mt-2 max-w-sm">{transcript}</p>
              )}
              {status === "Done ✓" && (
                <p className="font-mono text-xs text-green-600 mt-1 tracking-wider">✓ Recorded</p>
              )}
            </div>
          </div>

          {/* Image upload */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-gray-400 tracking-widest uppercase">
                Image extraction
              </span>
              <button
                onClick={() => imageInputRef.current?.click()}
                className="font-mono text-xs text-gray-500 hover:text-gray-900 border border-gray-200 px-3 py-1.5 hover:border-gray-400 transition-colors"
              >
                + Upload image
              </button>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
            </div>

            {imageLoading && (
              <div className="flex items-center gap-3 border border-gray-100 p-4">
                <div className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin shrink-0" />
                <p className="text-sm text-gray-500 font-light">{imageStatus}</p>
              </div>
            )}

            {!imageLoading && extracted.length > 0 && (
              <div className="border border-gray-100 divide-y divide-gray-100">
                {extracted.map((v, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{v.field_name}</p>
                      <p className="font-mono text-xs text-gray-400">{v.field_value} {v.unit}</p>
                    </div>
                    <button
                      onClick={() => confirmValue(v)}
                      className="px-3 py-1.5 bg-gray-900 text-white text-xs font-mono hover:bg-gray-700 transition-colors"
                    >
                      Confirm
                    </button>
                  </div>
                ))}
                {extracted.length > 1 && (
                  <div className="px-4 py-3">
                    <button
                      onClick={confirmAll}
                      className="w-full py-2 bg-gray-900 text-white text-xs font-mono hover:bg-gray-700 transition-colors"
                    >
                      Confirm all
                    </button>
                  </div>
                )}
              </div>
            )}

            {!imageLoading && extracted.length === 0 && imageFile && (
              <p className="text-sm text-gray-400 font-light">{imageStatus}</p>
            )}

            {!imageFile && !imageLoading && (
              <p className="text-sm text-gray-400 font-light">
                Upload an instrument photo to extract values automatically
              </p>
            )}
          </div>

          {/* Export */}
          <div className="flex items-center gap-3 border-t border-gray-100 pt-6">
            <span className="font-mono text-xs text-gray-400 tracking-widest uppercase mr-2">
              Export
            </span>
            <select
              id="format"
              className="border border-gray-200 px-3 py-1.5 text-xs font-mono text-gray-600 focus:outline-none focus:border-gray-400"
              defaultValue="pdf"
            >
              <option value="pdf">PDF</option>
              <option value="docx">Word (.docx)</option>
            </select>
            <label className="flex items-center gap-2 text-xs text-gray-500 font-mono">
              <input type="checkbox" id="transcripts" className="w-3 h-3" />
              Raw transcripts
            </label>
            <button
              onClick={() => {
                const format = (document.getElementById("format") as HTMLSelectElement).value;
                const transcripts = (document.getElementById("transcripts") as HTMLInputElement).checked;
                window.open(
                  `${process.env.NEXT_PUBLIC_API_URL}/export/${experimentId}?format=${format}&include_transcripts=${transcripts}`,
                  "_blank"
                );
              }}
              className="ml-auto px-4 py-1.5 bg-gray-900 text-white text-xs font-mono hover:bg-gray-700 transition-colors"
            >
              Download
            </button>
          </div>

          {/* Data table */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-gray-400 tracking-widest uppercase">
                Recorded data
              </span>
              <span className="font-mono text-xs text-gray-400">
                {entries.length} {entries.length === 1 ? "entry" : "entries"}
              </span>
            </div>

            {entries.length === 0 ? (
              <div className="border border-dashed border-gray-200 p-8 text-center">
                <p className="text-sm text-gray-400 font-light">
                  No data yet — start recording
                </p>
              </div>
            ) : (
              <div className="border border-gray-100 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-100">
                    <tr>
                      {["Field", "Value", "Unit", "Time", "Source"].map(h => (
                        <th key={h} className="text-left px-4 py-2.5 font-mono text-xs text-gray-400 tracking-wider uppercase">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {entries.map((entry) => (
                      <tr key={entry.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-medium text-gray-800 text-sm">{entry.field_name}</td>
                        <td className="px-4 py-3 font-mono text-sm text-gray-700">{entry.field_value}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-400">{entry.unit || "—"}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-400">{formatTime(entry.created_at)}</td>
                        <td className="px-4 py-3">
                          <span className={`font-mono text-xs px-2 py-0.5 ${
                            entry.source === "voice"
                              ? "bg-blue-50 text-blue-600"
                              : entry.source === "image"
                              ? "bg-purple-50 text-purple-600"
                              : "bg-gray-50 text-gray-500"
                          }`}>
                            {entry.source}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>
      </section>
    </main>
  );
}