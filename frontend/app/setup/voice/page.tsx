"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import RiskChat from "@/components/RiskChat";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type RiskItem = {
  risk: string;
  explanation: string;
  suggestion: string;
  sources: {
    title: string;
    year: string | number;
    doi: string;
    url: string | null;
    source: string;
  }[];
};

export default function VoiceSetupPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "What's the name of your experiment?" }
  ]);
  const [history, setHistory] = useState<{ role: string; content: string }[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("Click the mic to answer");
  const [riskLoading, setRiskLoading] = useState(false);
  const [riskItems, setRiskItems] = useState<RiskItem[]>([]);
  const [dismissedRisks, setDismissedRisks] = useState<Set<number>>(new Set());
  const [papersRetrieved, setPapersRetrieved] = useState(0);
  const [experimentReady, setExperimentReady] = useState<any>(null);
  const [protocolText, setProtocolText] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

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
        await processVoice(blob);
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setStatus("Recording... click to stop");
    }
  };

  const processVoice = async (blob: Blob) => {
    try {
      setStatus("Transcribing...");
      const formData = new FormData();
      formData.append("audio", blob, "recording.webm");
      const transcribeRes = await fetch("${process.env.NEXT_PUBLIC_API_URL}/transcribe", {
        method: "POST",
        body: formData,
      });
      const { text } = await transcribeRes.json();

      setMessages(prev => [...prev, { role: "user", content: text }]);
      setStatus("Thinking...");

      const res = await fetch("${process.env.NEXT_PUBLIC_API_URL}/setup/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, conversation_history: history })
      });
      const data = await res.json();

      setMessages(prev => [...prev, { role: "assistant", content: data.message }]);

      if (data.status === "collecting" && data.assistant_message) {
        setHistory(prev => [
          ...prev,
          { role: "user", content: text },
          data.assistant_message
        ]);
        setStatus("Click the mic to answer");
      }

      if (data.status === "ready") {
        setLoading(false);
        setExperimentReady(data);
        // Build protocol text from the full conversation
        const fullDescription = messages
          .filter(m => m.role === "user")
          .map(m => m.content)
          .concat(text)
          .join(" ");
        setProtocolText(fullDescription);
        setStatus("Experiment ready");
        return;
      }

    } catch (e) {
      setStatus("Error — try again");
    } finally {
      setLoading(false);
    }
  };

  const runRiskAnalysis = async (protocol: string, expId: string) => {
    setRiskLoading(true);
    setRiskItems([]);
    setDismissedRisks(new Set());
    try {
      const riskRes = await fetch("${process.env.NEXT_PUBLIC_API_URL}/analyze-experiment-design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          experiment_description: protocol,
          experiment_id: expId
        }),
      });
      const riskData = await riskRes.json();
      setRiskItems(riskData.risk_items || []);
      setPapersRetrieved(riskData.papers_retrieved || 0);
    } catch (e) {
      alert("Risk analysis failed — check backend");
    } finally {
      setRiskLoading(false);
    }
  };

  const dismissRisk = (i: number) => {
    setDismissedRisks(prev => new Set([...prev, i]));
  };

  const handleStart = () => {
    if (!experimentReady) return;
    router.push(
      `/experiment/${experimentReady.experiment_id}?subs=${encodeURIComponent(
        JSON.stringify(experimentReady.sub_experiments)
      )}`
    );
  };

  const visibleRisks = riskItems.filter((_, i) => !dismissedRisks.has(i));

  return (
    <main className="min-h-screen bg-white flex flex-col">

      {/* Top bar */}
      <header className="border-b border-gray-100 px-8 py-4 flex items-center justify-between">
        <button
          onClick={() => router.push("/setup")}
          className="flex items-center gap-3 hover:opacity-70 transition-opacity"
        >
          <div className="w-6 h-6 rounded-full border-2 border-gray-900" />
          <span className="font-mono text-sm font-medium tracking-widest uppercase text-gray-900">
            Lab Copilot
          </span>
        </button>
        <span className="font-mono text-xs text-gray-400 tracking-wider">Voice setup</span>
      </header>

      <section className="flex-1 flex flex-col items-center py-16 px-8">
        <div className="w-full max-w-2xl flex flex-col gap-8">

          {/* Heading */}
          <div className="border-b border-gray-100 pb-8">
            <p className="font-mono text-xs text-gray-400 tracking-widest uppercase mb-3">02 · Voice</p>
            <h1 className="text-3xl font-light text-gray-900 tracking-tight">Tell me about your experiment</h1>
            <p className="text-sm text-gray-500 font-light mt-2">
              Speak in one shot or answer guided questions. The agent will configure everything.
            </p>
          </div>

          {/* Chat messages */}
          <div className="w-full flex flex-col gap-3 min-h-48">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-sm px-4 py-3 text-sm ${
                  msg.role === "user"
                    ? "bg-gray-900 text-white"
                    : "bg-gray-50 text-gray-700 border border-gray-100"
                }`}>
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-gray-50 border border-gray-100 px-4 py-3 text-sm text-gray-400">
                  Thinking...
                </div>
              </div>
            )}
          </div>

          {/* Mic button — hidden once experiment is ready */}
          {!experimentReady && (
            <div className="flex flex-col items-center gap-4">
              <button
                onClick={toggleRecording}
                disabled={loading}
                className={`w-20 h-20 flex items-center justify-center border-2 text-2xl transition-all ${
                  isRecording
                    ? "border-red-500 bg-red-50 text-red-500 scale-110"
                    : loading
                    ? "border-gray-200 text-gray-300 cursor-not-allowed"
                    : "border-gray-900 text-gray-900 hover:bg-gray-50"
                }`}
              >
                {isRecording ? "■" : "🎙"}
              </button>
              <p className="font-mono text-xs text-gray-400 tracking-wider">{status}</p>
            </div>
          )}

          {/* Optional risk analysis trigger */}
          {experimentReady && !riskLoading && riskItems.length === 0 && (
            <button
              onClick={() => runRiskAnalysis(protocolText, experimentReady.experiment_id)}
              className="w-full py-3 bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 transition-colors"
            >
              Analyze Risks from Literature · ~20s
            </button>
          )}

          {/* Risk loading */}
          {riskLoading && (
            <div className="w-full border border-amber-100 p-5 flex items-center gap-3">
              <div className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin shrink-0" />
              <p className="text-sm text-amber-700 font-light">
                Searching literature for risks... ~20 seconds
              </p>
            </div>
          )}

          {/* Risk cards */}
          {!riskLoading && visibleRisks.length > 0 && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <p className="font-mono text-xs text-gray-500 tracking-widest uppercase">
                  Risk flags · {visibleRisks.length} item{visibleRisks.length !== 1 ? "s" : ""}
                </p>
                <p className="font-mono text-xs text-gray-400">{papersRetrieved} papers retrieved</p>
              </div>

              {riskItems.map((item, i) => {
                if (dismissedRisks.has(i)) return null;
                return (
                  <div key={i} className="border border-amber-200 bg-amber-50 p-5 flex flex-col gap-3">
                    <div className="flex justify-between items-start">
                      <p className="font-medium text-amber-900 text-sm">⚠ {item.risk}</p>
                      <button
                        onClick={() => dismissRisk(i)}
                        className="font-mono text-xs text-gray-400 hover:text-gray-600 ml-4 shrink-0"
                      >
                        Dismiss
                      </button>
                    </div>
                    <p className="text-sm text-amber-800 font-light">{item.explanation}</p>
                    <div className="border border-amber-200 bg-white px-4 py-3">
                      <p className="font-mono text-xs text-amber-600 uppercase tracking-wider mb-1">Suggestion</p>
                      <p className="text-sm text-gray-700 font-light">{item.suggestion}</p>
                    </div>
                    {item.sources.length > 0 && (
                      <div className="flex flex-col gap-1">
                        <p className="font-mono text-xs text-gray-400 uppercase tracking-wider">Sources</p>
                        {item.sources.map((s, j) => (
                          <div key={j} className="flex items-start gap-2">
                            <span className="font-mono text-xs text-gray-400 mt-0.5">[{j + 1}]</span>
                            {s.url ? (
                              <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                                {s.title} ({s.year}) ↗
                              </a>
                            ) : (
                              <p className="text-xs text-gray-500">{s.title} ({s.year})</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {!riskLoading && riskItems.length === 0 && papersRetrieved > 0 && (
            <div className="border border-green-100 bg-green-50 p-4">
              <p className="text-sm text-green-700 font-light">✓ No significant risks flagged from the literature.</p>
            </div>
          )}

          {/* Risk chat */}
          {riskItems.length > 0 && !riskLoading && (
            <RiskChat
              protocolText={protocolText}
              riskItems={riskItems}
              experimentId={experimentReady?.experiment_id || null}
              onProtocolUpdate={(updated) => setProtocolText(updated)}
              onRiskRerun={(updated) => runRiskAnalysis(updated, experimentReady.experiment_id)}
            />
          )}

          {/* Start button */}
          {experimentReady && !riskLoading && (
            <button
              onClick={handleStart}
              className="w-full py-3 bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 transition-colors"
            >
              Start Experiment →
            </button>
          )}

        </div>
      </section>
    </main>
  );
}