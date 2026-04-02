"use client";
import { useState, useRef, useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
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
  const experimentId = params.id as string;

  const subExperiments: SubExperiment[] = JSON.parse(
    decodeURIComponent(searchParams.get("subs") || "[]")
  );
  const [activeSubId, setActiveSubId] = useState(subExperiments[0]?.id || "");

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

  const activeSub = subExperiments.find(s => s.id === activeSubId);

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
      const transcribeRes = await fetch("${process.env.NEXT_PUBLIC_API_URL}/transcribe", {
        method: "POST",
        body: formData,
      });
      const transcribeData = await transcribeRes.json();
      const text = transcribeData.text;
      setTranscript(text);

      setStatus("Thinking...");
      const agentRes = await fetch("${process.env.NEXT_PUBLIC_API_URL}/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: text,
          experiment_id: experimentId,
          active_sub_experiment_id: activeSubId,
          sub_experiments: subExperiments
        }),
      });
      await agentRes.json();
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

      const res = await fetch("${process.env.NEXT_PUBLIC_API_URL}/vision/extract", {
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
    await fetch("${process.env.NEXT_PUBLIC_API_URL}/vision/confirm", {
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
    for (const value of extracted) {
      await confirmValue(value);
    }
  };

  const formatTime = (ts: string) =>
    new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <main className="flex flex-col items-center min-h-screen gap-6 p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold">AI Lab Copilot</h1>

      {/* Sub-experiment tabs */}
      {subExperiments.length > 1 && (
        <div className="w-full flex gap-2">
          {subExperiments.map(sub => (
            <button
              key={sub.id}
              onClick={() => setActiveSubId(sub.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeSubId === sub.id
                  ? "bg-blue-500 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {sub.name}
            </button>
          ))}
        </div>
      )}

      <p className="text-gray-500 text-sm w-full">
        {activeSub?.name} · {activeSub?.fields.length > 0 ? activeSub.fields.join(", ") : "no fields defined"}
      </p>

      {/* Record button */}
      <button
        onClick={toggleRecording}
        disabled={loading}
        className={`w-32 h-32 rounded-full text-white font-bold text-lg transition-all ${
          isRecording
            ? "bg-red-500 scale-110 shadow-lg shadow-red-300"
            : loading
            ? "bg-gray-400 cursor-not-allowed"
            : "bg-blue-500 hover:bg-blue-600"
        }`}
      >
        {isRecording ? "Click to stop" : loading ? "..." : "Click to record"}
      </button>

      {/* Transcript */}
      <div className="w-full p-4 border rounded-xl bg-gray-50">
        <p className="text-xs text-gray-400 mb-1">Transcript · {status}</p>
        <p className="text-gray-800">{transcript || "Your words will appear here"}</p>
      </div>

      {/* Image upload */}
      <div className="w-full border rounded-xl overflow-hidden">
        <div className="bg-gray-100 px-4 py-2 flex justify-between items-center">
          <p className="font-semibold text-sm">Image Upload</p>
          <button
            onClick={() => imageInputRef.current?.click()}
            className="text-xs text-blue-500 hover:text-blue-700"
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
          <p className="text-sm text-gray-400 p-4">{imageStatus}</p>
        )}

        {!imageLoading && extracted.length > 0 && (
          <div className="p-4 flex flex-col gap-3">
            <p className="text-xs text-gray-400">{imageStatus}</p>
            {extracted.map((v, i) => (
              <div key={i} className="flex items-center justify-between bg-gray-50 border rounded-xl px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{v.field_name}</p>
                  <p className="text-sm text-gray-500">{v.field_value} {v.unit}</p>
                </div>
                <button
                  onClick={() => confirmValue(v)}
                  className="px-3 py-1 bg-blue-500 text-white text-xs rounded-lg hover:bg-blue-600"
                >
                  Confirm
                </button>
              </div>
            ))}
            {extracted.length > 1 && (
              <button
                onClick={confirmAll}
                className="w-full py-2 bg-green-500 text-white text-sm rounded-xl hover:bg-green-600"
              >
                Confirm all
              </button>
            )}
          </div>
        )}

        {!imageLoading && extracted.length === 0 && imageFile && (
          <p className="text-sm text-gray-400 p-4">{imageStatus}</p>
        )}

        {!imageFile && (
          <p className="text-sm text-gray-400 p-4">Upload an image to extract values automatically</p>
        )}
      </div>

      {/* Export controls */}
      <div className="w-full flex gap-3 items-center">
        <select id="format" className="border rounded-lg px-3 py-2 text-sm" defaultValue="pdf">
          <option value="pdf">PDF</option>
          <option value="docx">Word (.docx)</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" id="transcripts" />
          Include raw transcripts
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
          className="ml-auto px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700"
        >
          Export
        </button>
      </div>

      {/* Data table */}
      <div className="w-full border rounded-xl overflow-hidden">
        <div className="bg-gray-100 px-4 py-2 flex justify-between items-center">
          <p className="font-semibold text-sm">Recorded Data</p>
          <p className="text-xs text-gray-400">{entries.length} entries</p>
        </div>
        {entries.length === 0 ? (
          <p className="text-gray-400 text-sm p-4">No data yet — start recording</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-2 text-gray-500 font-medium">Field</th>
                <th className="text-left px-4 py-2 text-gray-500 font-medium">Value</th>
                <th className="text-left px-4 py-2 text-gray-500 font-medium">Unit</th>
                <th className="text-left px-4 py-2 text-gray-500 font-medium">Time</th>
                <th className="text-left px-4 py-2 text-gray-500 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) => (
                <tr key={entry.id} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                  <td className="px-4 py-2 font-medium">{entry.field_name}</td>
                  <td className="px-4 py-2">{entry.field_value}</td>
                  <td className="px-4 py-2 text-gray-400">{entry.unit || "—"}</td>
                  <td className="px-4 py-2 text-gray-400">{formatTime(entry.created_at)}</td>
                  <td className="px-4 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${
                      entry.source === "voice"
                        ? "bg-blue-100 text-blue-700"
                        : entry.source === "image"
                        ? "bg-purple-100 text-purple-700"
                        : "bg-gray-100 text-gray-600"
                    }`}>
                      {entry.source}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}