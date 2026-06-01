"use client";
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";

// ── Types ─────────────────────────────────────────────────────

type RiskItem = {
  severity: "high" | "medium" | "suggestion";
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

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type AppPhase = "input" | "analyzing" | "results";

const SEVERITY_CONFIG = {
  high: {
    label: "High",
    borderColor: "border-l-red-400",
    bg: "bg-red-50",
    titleColor: "text-red-900",
    badge: "bg-red-100 text-red-700",
    dot: "bg-red-500",
  },
  medium: {
    label: "Medium",
    borderColor: "border-l-amber-400",
    bg: "bg-amber-50",
    titleColor: "text-amber-900",
    badge: "bg-amber-100 text-amber-700",
    dot: "bg-amber-400",
  },
  suggestion: {
    label: "Suggestion",
    borderColor: "border-l-gray-300",
    bg: "bg-gray-50",
    titleColor: "text-gray-800",
    badge: "bg-gray-100 text-gray-600",
    dot: "bg-gray-300",
  },
};

const SUPPLEMENTARY_TYPES = [
  {
    key: "instrument",
    icon: "⚙️",
    label: "Instrument manual / spec sheet",
    hint: "Flags parameter settings specific to your equipment",
  },
  {
    key: "publication",
    icon: "📄",
    label: "Related publication",
    hint: "A paper your design is based on",
  },
  {
    key: "prior_protocol",
    icon: "🗂",
    label: "Lab's prior protocol",
    hint: "Your lab's previous version of this experiment",
  },
  {
    key: "pilot_data",
    icon: "📊",
    label: "Preliminary / pilot data",
    hint: "Early results that informed this design",
  },
];

// ── Main component ────────────────────────────────────────────

export default function AppPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<AppPhase>("input");

  // Left panel — input
  const [inputMode, setInputMode] = useState<"file" | "text">("file");
  const [file, setFile] = useState<File | null>(null);
  const [extractedText, setExtractedText] = useState("");
  const [textInput, setTextInput] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [supplementaryFiles, setSupplementaryFiles] = useState<Record<string, File | null>>({});
  const [supplementaryTexts, setSupplementaryTexts] = useState<Record<string, string>>({});
  const [riskItems, setRiskItems] = useState<RiskItem[]>([]);
  const [dismissedRisks, setDismissedRisks] = useState<Set<number>>(new Set());
  const [papersRetrieved, setPapersRetrieved] = useState(0);
  const [analysisProtocol, setAnalysisProtocol] = useState("");
  const [statusText, setStatusText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const supFileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Right panel — chat
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: "Hi! I'm here to help you get the most out of this analysis. You can upload your protocol on the left, and I'll help you think through your research question and what you're trying to prove.\n\nOr just start talking — what experiment are you working on?",
    },
  ]);
  const [chatHistory, setChatHistory] = useState<{ role: string; content: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [onboardingContext, setOnboardingContext] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);
  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/health`).catch(() => {});
  }, []);

  // ── File handling ─────────────────────────────────────────────

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setExtracting(true);
    try {
      const formData = new FormData();
      formData.append("file", f);
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/extract-text`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      setExtractedText(data.text || "");
    } catch {
      setExtractedText("");
    } finally {
      setExtracting(false);
    }
  };

  const handleSupplementaryFile = async (key: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setSupplementaryFiles(prev => ({ ...prev, [key]: f }));
    try {
      const formData = new FormData();
      formData.append("file", f);
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/extract-text`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      setSupplementaryTexts(prev => ({ ...prev, [key]: data.text || "" }));
    } catch {}
  };

  const buildFullDescription = () => {
    const primary = inputMode === "file" ? extractedText : textInput;
    const supParts = SUPPLEMENTARY_TYPES
      .filter(t => supplementaryTexts[t.key])
      .map(t => `--- ${t.label} ---\n${supplementaryTexts[t.key]}`)
      .join("\n\n");
    return supParts ? `${primary}\n\n=== SUPPLEMENTARY MATERIALS ===\n\n${supParts}` : primary;
  };

  const hasInput = inputMode === "file" ? !!file : !!textInput.trim();

  // ── Analysis ──────────────────────────────────────────────────

  const runAnalysis = async () => {
    const description = buildFullDescription();
    if (!description.trim()) return;
    setAnalysisProtocol(description);
    setPhase("analyzing");
    setStatusText("Searching PubMed and Semantic Scholar...");

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/analyze-experiment-design`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          experiment_description: description,
          onboarding_context: onboardingContext,
        }),
      });
      const data = await res.json();
      setRiskItems(data.risk_items || []);
      setPapersRetrieved(data.papers_retrieved || 0);
      setDismissedRisks(new Set());
      setPhase("results");

      // Notify agent of results
      const summaryMsg = `Analysis complete — ${data.risk_items?.length || 0} risk flags identified (${data.papers_retrieved} papers retrieved). I can now help you understand any specific flag or suggest how to address it.`;
      setMessages(prev => [...prev, { role: "assistant", content: summaryMsg }]);

    } catch {
      setStatusText("Analysis failed — check backend");
      setPhase("input");
    }
  };

  // ── Chat ──────────────────────────────────────────────────────

  const sendChatMessage = async (text: string) => {
    if (!text.trim() || chatLoading) return;
    setChatInput("");
    const userMsg: ChatMessage = { role: "user", content: text };
    setMessages(prev => [...prev, userMsg]);
    setChatLoading(true);

    try {
      const mode = phase === "results" ? "post" : "pre";
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/app/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          conversation_history: chatHistory,
          mode,
          protocol_text: analysisProtocol,
          risk_items: riskItems,
        }),
      });
      const data = await res.json();
      const assistantContent = data.content || "";

      setMessages(prev => [...prev, { role: "assistant", content: assistantContent }]);
      setChatHistory(prev => [
        ...prev,
        { role: "user", content: text },
        { role: "assistant", content: assistantContent },
      ]);

      // Accumulate onboarding context from pre-analysis chat
      if (mode === "pre") {
        setOnboardingContext(prev =>
          prev ? `${prev}\n${text}` : text
        );
      }

      // Handle protocol updates from post-analysis
      if (data.type === "protocol_update" && data.updated_protocol) {
        setAnalysisProtocol(data.updated_protocol);
        // Re-run analysis with updated protocol
        const reRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/analyze-experiment-design`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            experiment_description: data.updated_protocol,
            previous_risk_items: riskItems,
          }),
        });
        const reData = await reRes.json();
        setRiskItems(reData.risk_items || []);
        setPapersRetrieved(reData.papers_retrieved || 0);
        setDismissedRisks(new Set());
      }

    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Error — check if backend is running." }]);
    } finally {
      setChatLoading(false);
    }
  };

  // ── Voice ─────────────────────────────────────────────────────

  const toggleRecording = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      setVoiceLoading(true);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        chunksRef.current = [];

        mediaRecorder.ondataavailable = (e) => chunksRef.current.push(e.data);
        mediaRecorder.onstop = async () => {
          const blob = new Blob(chunksRef.current, { type: "audio/webm" });
          stream.getTracks().forEach(t => t.stop());
          try {
            const formData = new FormData();
            formData.append("audio", blob, "recording.webm");
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/transcribe`, {
              method: "POST",
              body: formData,
            });
            const data = await res.json();
            if (data.text) await sendChatMessage(data.text);
          } catch {
            setMessages(prev => [...prev, { role: "assistant", content: "Voice transcription failed — try again." }]);
          } finally {
            setVoiceLoading(false);
          }
        };

        mediaRecorder.start();
        setIsRecording(true);
      } catch {
        alert("Microphone access denied. Please allow microphone access and try again.");
      }
    }
  };

  const handleExportPDF = () => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/risk/export-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ experiment_description: analysisProtocol, risk_items: riskItems }),
    })
      .then(res => res.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "risk_analysis_report.pdf";
        a.click();
        URL.revokeObjectURL(url);
      });
  };

  const visibleRisks = riskItems.filter((_, i) => !dismissedRisks.has(i));

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#F7F6F2", fontFamily: "'DM Sans', sans-serif" }}>

      {/* Header */}
      <header className="px-6 py-3 flex items-center justify-between shrink-0" style={{ background: "#1a1a1a", borderBottom: "1px solid #2d2d2d" }}>
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/")}
            className="flex items-center gap-1.5 transition-opacity hover:opacity-70"
            style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#888", letterSpacing: "0.06em" }}
          >
            ← Home
          </button>
          {phase !== "input" && (
            <button
              onClick={() => {
                setPhase("input");
                setRiskItems([]);
                setFile(null);
                setExtractedText("");
                setTextInput("");
                setDismissedRisks(new Set());
              }}
              className="transition-opacity hover:opacity-70"
              style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#888", letterSpacing: "0.06em" }}
            >
              ← New analysis
            </button>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          <div className="w-4 h-4 rounded-full border-2" style={{ borderColor: "#c8f0a0" }} />
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: "#c8f0a0", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Lab Design Litmus
          </span>
        </div>

        <div className="flex items-center gap-3">
          {phase === "results" && (
            <button
              onClick={handleExportPDF}
              className="transition-all hover:opacity-80"
              style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#1a1a1a", background: "#c8f0a0", padding: "5px 12px", letterSpacing: "0.04em" }}
            >
              Export PDF
            </button>
          )}
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#666", letterSpacing: "0.06em" }}>
            {phase === "input" && "Protocol upload"}
            {phase === "analyzing" && "Searching literature..."}
            {phase === "results" && `${visibleRisks.length} flags · ${papersRetrieved} papers`}
          </span>
        </div>
      </header>

      {/* Two-panel body */}
      <div className="flex-1 flex overflow-hidden" style={{ height: "calc(100vh - 49px)" }}>

        {/* ── LEFT PANEL ── */}
        <div className="w-1/2 overflow-y-auto p-8" style={{ borderRight: "1px solid #e8e6e0" }}>
          <div className="max-w-lg mx-auto flex flex-col gap-6">

            {/* Section heading */}
            <div className="pb-6" style={{ borderBottom: "1px solid #e8e6e0" }}>
              <p style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#a8a49e", letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 10 }}>
                {phase === "input" ? "01 · Upload" : phase === "analyzing" ? "Analyzing" : "Results"}
              </p>
              <h1 style={{ fontSize: 26, fontWeight: 300, color: "#1a1a1a", letterSpacing: "-0.02em", lineHeight: 1.2 }}>
                {phase === "input" && "Your experiment protocol"}
                {phase === "analyzing" && "Searching literature..."}
                {phase === "results" && "Risk Analysis"}
              </h1>
            </div>

            {/* ── INPUT STATE ── */}
            {phase === "input" && (
              <>
                {/* Input mode toggle */}
                <div className="flex" style={{ border: "1px solid #e0ddd8", borderRadius: 2 }}>
                  <button
                    onClick={() => setInputMode("file")}
                    style={{
                      flex: 1, padding: "9px 0", fontSize: 13, fontWeight: 500, transition: "all 0.15s",
                      background: inputMode === "file" ? "#1a1a1a" : "transparent",
                      color: inputMode === "file" ? "white" : "#888",
                      border: "none", cursor: "pointer"
                    }}
                  >
                    Upload file
                  </button>
                  <button
                    onClick={() => setInputMode("text")}
                    style={{
                      flex: 1, padding: "9px 0", fontSize: 13, fontWeight: 500, transition: "all 0.15s",
                      background: inputMode === "text" ? "#1a1a1a" : "transparent",
                      color: inputMode === "text" ? "white" : "#888",
                      border: "none", cursor: "pointer"
                    }}
                  >
                    Paste text
                  </button>
                </div>

                {/* File upload */}
                {inputMode === "file" && (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      border: "1.5px dashed #d0cdc8", padding: "44px 24px", textAlign: "center",
                      cursor: "pointer", background: "#faf9f7", transition: "all 0.2s",
                      borderRadius: 3,
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "#888"; (e.currentTarget as HTMLElement).style.background = "#f4f3f0"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "#d0cdc8"; (e.currentTarget as HTMLElement).style.background = "#faf9f7"; }}
                  >
                    {extracting ? (
                      <p style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#888", letterSpacing: "0.08em" }}>Reading file...</p>
                    ) : file ? (
                      <div>
                        <p style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#5a9a5a", letterSpacing: "0.08em", marginBottom: 4 }}>✓ {file.name}</p>
                        <p style={{ fontSize: 12, color: "#aaa" }}>Click to replace</p>
                      </div>
                    ) : (
                      <div>
                        <div style={{ fontSize: 28, marginBottom: 12 }}>📄</div>
                        <p style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#888", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>Click to upload protocol</p>
                        <p style={{ fontSize: 12, color: "#bbb", letterSpacing: "0.04em" }}>PDF · DOCX · TXT</p>
                      </div>
                    )}
                    <input ref={fileInputRef} type="file" accept=".txt,.pdf,.docx" onChange={handleFileSelect} className="hidden" />
                  </div>
                )}

                {/* Text paste */}
                {inputMode === "text" && (
                  <textarea
                    value={textInput}
                    onChange={e => setTextInput(e.target.value)}
                    placeholder="Paste your protocol or describe your experiment here..."
                    style={{
                      width: "100%", border: "1px solid #e0ddd8", padding: "14px 16px",
                      fontSize: 13, fontWeight: 300, color: "#1a1a1a", background: "#faf9f7",
                      outline: "none", resize: "none", borderRadius: 2, lineHeight: 1.6,
                      fontFamily: "'DM Sans', sans-serif",
                    }}
                    rows={8}
                  />
                )}

                {/* ── SUPPORTING MATERIALS ── */}
                <div style={{ border: "1px solid #e0ddd8", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ background: "#1a1a1a", padding: "14px 18px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#c8f0a0" }} />
                      <p style={{ color: "white", fontSize: 13, fontWeight: 500, margin: 0 }}>Add supporting materials</p>
                      <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#666", marginLeft: "auto", letterSpacing: "0.06em" }}>optional</span>
                    </div>
                    <p style={{ color: "#888", fontSize: 11, fontWeight: 300, marginTop: 6, paddingLeft: 17, letterSpacing: "0.02em" }}>
                      The more context you provide, the more specific the risk flags.
                    </p>
                  </div>
                  <div style={{ background: "white" }}>
                    {SUPPLEMENTARY_TYPES.map((type, idx) => {
                      const uploaded = !!supplementaryFiles[type.key];
                      return (
                        <div
                          key={type.key}
                          style={{
                            padding: "14px 18px", display: "flex", alignItems: "center", gap: 14,
                            borderTop: idx > 0 ? "1px solid #f0ede8" : "none",
                            background: uploaded ? "#f0faf0" : "white",
                            transition: "background 0.15s",
                          }}
                        >
                          <span style={{ fontSize: 18, flexShrink: 0 }}>{type.icon}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontSize: 13, color: "#1a1a1a", fontWeight: 500, margin: 0 }}>{type.label}</p>
                            <p style={{ fontSize: 11, color: "#aaa", fontWeight: 300, marginTop: 2 }}>{type.hint}</p>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                            {uploaded && <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#5a9a5a" }}>✓</span>}
                            <button
                              onClick={() => supFileRefs.current[type.key]?.click()}
                              style={{
                                fontFamily: "'DM Mono', monospace", fontSize: 11, padding: "5px 12px",
                                border: uploaded ? "1px solid #a0d8a0" : "1px solid #e0ddd8",
                                color: uploaded ? "#5a9a5a" : "#888",
                                background: "transparent", cursor: "pointer", letterSpacing: "0.04em",
                                transition: "all 0.15s",
                              }}
                            >
                              {uploaded ? "Replace" : "Upload"}
                            </button>
                            <input
                              ref={el => { supFileRefs.current[type.key] = el; }}
                              type="file" accept=".txt,.pdf,.docx"
                              onChange={e => handleSupplementaryFile(type.key, e)}
                              className="hidden"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Analyze button */}
                <button
                  onClick={runAnalysis}
                  disabled={!hasInput}
                  style={{
                    width: "100%", padding: "15px 0", display: "flex", alignItems: "center",
                    justifyContent: "center", gap: 10, fontSize: 14, fontWeight: 500,
                    background: hasInput ? "#1a1a1a" : "#e8e6e0", color: hasInput ? "white" : "#aaa",
                    border: "none", cursor: hasInput ? "pointer" : "not-allowed",
                    transition: "all 0.2s", letterSpacing: "0.02em", borderRadius: 2,
                    boxShadow: hasInput ? "0 2px 8px rgba(0,0,0,0.15)" : "none",
                  }}
                >
                  {hasInput ? (
                    <>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                      </svg>
                      Analyze risks from literature
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                        <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </>
                  ) : (
                    "Upload a protocol to analyze"
                  )}
                </button>
              </>
            )}

            {/* ── ANALYZING STATE ── */}
            {phase === "analyzing" && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20, padding: "64px 0" }}>
                <div style={{ width: 36, height: 36, border: "2px solid #1a1a1a", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                <div style={{ textAlign: "center" }}>
                  <p style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#888", letterSpacing: "0.12em", textTransform: "uppercase" }}>{statusText}</p>
                  <p style={{ fontSize: 13, color: "#aaa", fontWeight: 300, marginTop: 8 }}>Typically 20–40 seconds</p>
                </div>
                <style>{`@keyframes spin { to { transform: rotate(360deg); }}`}</style>
              </div>
            )}

            {/* ── RESULTS STATE ── */}
            {phase === "results" && (
              <>
                {/* Severity summary */}
                <div style={{ display: "flex", gap: 16 }}>
                  {["high", "medium", "suggestion"].map(sev => {
                    const count = visibleRisks.filter(r => r.severity === sev).length;
                    if (!count) return null;
                    const dotColors: Record<string, string> = { high: "#ef4444", medium: "#f59e0b", suggestion: "#9ca3af" };
                    return (
                      <span key={sev} style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#666" }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColors[sev], display: "inline-block" }} />
                        {count} {sev}
                      </span>
                    );
                  })}
                </div>

                {/* Risk cards */}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {riskItems.map((item, i) => {
                    if (dismissedRisks.has(i)) return null;
                    const borderColors: Record<string, string> = { high: "#f87171", medium: "#fbbf24", suggestion: "#d1d5db" };
                    const bgColors: Record<string, string> = { high: "#fef2f2", medium: "#fffbeb", suggestion: "#f9fafb" };
                    const badgeBg: Record<string, string> = { high: "#fee2e2", medium: "#fef3c7", suggestion: "#f3f4f6" };
                    const badgeColor: Record<string, string> = { high: "#dc2626", medium: "#d97706", suggestion: "#6b7280" };
                    const titleColor: Record<string, string> = { high: "#991b1b", medium: "#92400e", suggestion: "#374151" };
                    const sev = item.severity || "suggestion";
                    return (
                      <div key={i} style={{
                        borderLeft: `4px solid ${borderColors[sev]}`,
                        background: bgColors[sev],
                        padding: "14px 16px",
                        display: "flex", flexDirection: "column", gap: 8,
                        borderRadius: "0 3px 3px 0",
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <span style={{
                              fontFamily: "'DM Mono', monospace", fontSize: 10, padding: "2px 8px",
                              background: badgeBg[sev], color: badgeColor[sev],
                              letterSpacing: "0.08em", textTransform: "uppercase", alignSelf: "flex-start",
                            }}>
                              {item.severity}
                            </span>
                            <p style={{ fontSize: 13, fontWeight: 600, color: titleColor[sev], margin: 0 }}>{item.risk}</p>
                          </div>
                          <button
                            onClick={() => setDismissedRisks(prev => new Set([...prev, i]))}
                            style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#aaa", background: "none", border: "none", cursor: "pointer", marginLeft: 12, flexShrink: 0 }}
                          >
                            Dismiss
                          </button>
                        </div>
                        <p style={{ fontSize: 13, fontWeight: 300, color: "#374151", lineHeight: 1.55, margin: 0 }}>{item.explanation}</p>
                        <div style={{ border: "1px solid #e5e7eb", background: "white", padding: "10px 12px", borderRadius: 2 }}>
                          <p style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: "#aaa", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Suggestion</p>
                          <p style={{ fontSize: 13, fontWeight: 300, color: "#374151", margin: 0, lineHeight: 1.55 }}>{item.suggestion}</p>
                        </div>
                        {item.sources.length > 0 && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <p style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: "#aaa", letterSpacing: "0.1em", textTransform: "uppercase", margin: 0 }}>Sources</p>
                            {item.sources.map((s, j) => (
                              <div key={j} style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#aaa" }}>[{j+1}]</span>
                                {s.url ? (
                                  <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#2563eb", textDecoration: "none" }}>
                                    {s.title} ({s.year}) ↗
                                  </a>
                                ) : (
                                  <p style={{ fontSize: 11, color: "#9ca3af", margin: 0 }}>{s.title} ({s.year})</p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {visibleRisks.length === 0 && (
                    <div style={{ border: "1px solid #bbf7d0", background: "#f0fdf4", padding: 16, borderRadius: 3 }}>
                      <p style={{ fontSize: 13, color: "#15803d", fontWeight: 300, margin: 0 }}>✓ No significant risks flagged.</p>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: 10, borderTop: "1px solid #e8e6e0", paddingTop: 16 }}>
                  <button
                    onClick={() => { setPhase("input"); setRiskItems([]); setFile(null); setExtractedText(""); setTextInput(""); setDismissedRisks(new Set()); }}
                    style={{ flex: 1, padding: "10px 0", border: "1px solid #e0ddd8", color: "#555", fontSize: 13, background: "white", cursor: "pointer", transition: "background 0.15s", borderRadius: 2 }}
                  >
                    New analysis
                  </button>
                  <button
                    onClick={handleExportPDF}
                    style={{ flex: 1, padding: "10px 0", background: "#1a1a1a", color: "white", fontSize: 13, border: "none", cursor: "pointer", transition: "background 0.15s", borderRadius: 2 }}
                  >
                    Export PDF
                  </button>
                </div>
              </>
            )}

          </div>
        </div>

        {/* ── RIGHT PANEL — CHAT ── */}
        <div className="w-1/2 shrink-0 flex flex-col" style={{ background: "#F2F0EC", borderLeft: "1px solid #e0ddd8" }}>

          {/* Chat header */}
          <div style={{ background: "#1a1a1a", padding: "14px 20px", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#c8f0a0", animation: "pulse 2s infinite" }} />
              <p style={{ color: "white", fontSize: 14, fontWeight: 500, margin: 0 }}>Your personal lab design assistant</p>
            </div>
            <p style={{ color: "#888", fontSize: 11, fontWeight: 300, margin: 0, paddingLeft: 15, letterSpacing: "0.02em" }}>
              {phase === "results"
                ? "Ask about any risk flag, or request protocol changes by voice or text"
                : "Tell me about your experiment to improve the analysis — or skip and click Analyze"}
            </p>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
            {messages.map((msg, i) => (
              <div key={i} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
                <div style={{
                  maxWidth: "78%", fontSize: 13, padding: "10px 14px", lineHeight: 1.55,
                  borderRadius: 3,
                  background: msg.role === "user" ? "#1a1a1a" : "white",
                  color: msg.role === "user" ? "white" : "#374151",
                  border: msg.role === "user" ? "none" : "1px solid #e8e6e0",
                  boxShadow: msg.role === "assistant" ? "0 1px 3px rgba(0,0,0,0.04)" : "none",
                }}>
                  <ReactMarkdown
                    components={{
                      p: ({children}) => <p style={{ margin: "0 0 8px 0" }}>{children}</p>,
                      strong: ({children}) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
                      ul: ({children}) => <ul style={{ margin: "4px 0", paddingLeft: 16 }}>{children}</ul>,
                      ol: ({children}) => <ol style={{ margin: "4px 0", paddingLeft: 16 }}>{children}</ol>,
                      li: ({children}) => <li style={{ marginBottom: 4 }}>{children}</li>,
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                </div>
              </div>
            ))}
            {(chatLoading || voiceLoading) && (
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                <div style={{ background: "white", border: "1px solid #e8e6e0", padding: "10px 14px", fontSize: 13, color: "#aaa", borderRadius: 3 }}>
                  {voiceLoading ? "Transcribing..." : "Thinking..."}
                </div>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Chat input */}
          <div style={{ borderTop: "1px solid #e0ddd8", padding: 16, flexShrink: 0, background: "#eeece8" }}>

            {/* Voice button — large, primary */}
            <button
              onClick={toggleRecording}
              disabled={chatLoading || voiceLoading}
              style={{
                width: "100%", padding: "13px 0", display: "flex", alignItems: "center",
                justifyContent: "center", gap: 10, fontSize: 13, fontWeight: 500,
                marginBottom: 10, border: "none", cursor: chatLoading || voiceLoading ? "not-allowed" : "pointer",
                transition: "all 0.2s", borderRadius: 2,
                background: isRecording ? "#ef4444" : chatLoading || voiceLoading ? "#d8d6d2" : "#1a1a1a",
                color: isRecording ? "white" : chatLoading || voiceLoading ? "#aaa" : "white",
                boxShadow: isRecording ? "0 4px 12px rgba(239,68,68,0.3)" : chatLoading || voiceLoading ? "none" : "0 2px 8px rgba(0,0,0,0.15)",
              }}
            >
              {isRecording ? (
                <>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: "white", display: "inline-block" }} />
                  Stop recording
                  <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, opacity: 0.7 }}>●</span>
                </>
              ) : voiceLoading ? (
                <>
                  <span style={{ width: 14, height: 14, border: "2px solid #aaa", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin 0.8s linear infinite" }} />
                  Transcribing...
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    <line x1="12" y1="19" x2="12" y2="23"/>
                    <line x1="8" y1="23" x2="16" y2="23"/>
                  </svg>
                  Speak to your assistant
                </>
              )}
            </button>

            {/* Text input row */}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <textarea
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendChatMessage(chatInput);
                  }
                }}
                placeholder="Or type a message..."
                disabled={chatLoading || voiceLoading || isRecording}
                style={{
                  flex: 1, border: "1px solid #d8d6d2", padding: "9px 12px", fontSize: 13,
                  fontFamily: "'DM Sans', sans-serif", background: "white", outline: "none",
                  resize: "none", borderRadius: 2, maxHeight: 80, lineHeight: 1.4,
                  color: "#1a1a1a",
                }}
                rows={1}
              />
              <button
                onClick={() => sendChatMessage(chatInput)}
                disabled={chatLoading || !chatInput.trim()}
                style={{
                  padding: "9px 16px", fontSize: 13, fontWeight: 500,
                  background: chatInput.trim() ? "#1a1a1a" : "#d8d6d2",
                  color: chatInput.trim() ? "white" : "#aaa",
                  border: "none", cursor: chatInput.trim() ? "pointer" : "not-allowed",
                  flexShrink: 0, borderRadius: 2, transition: "all 0.15s",
                }}
              >
                Send
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}