"use client";
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

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
    <div className="min-h-screen bg-white flex flex-col">

      {/* Header */}
      <header className="border-b border-gray-100 px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/")}
            className="font-mono text-xs text-gray-400 hover:text-gray-700 transition-colors flex items-center gap-1.5"
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
              className="font-mono text-xs text-gray-400 hover:text-gray-700 transition-colors"
            >
              ← New analysis
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="w-5 h-5 rounded-full border-2 border-gray-900" />
          <span className="font-mono text-xs font-medium tracking-widest uppercase text-gray-900">
            Lab Design Litmus
          </span>
        </div>

        <div className="flex items-center gap-3">
          {phase === "results" && (
            <button
              onClick={handleExportPDF}
              className="font-mono text-xs px-3 py-1.5 bg-gray-900 text-white hover:bg-gray-700 transition-colors"
            >
              Export PDF
            </button>
          )}
          <span className="font-mono text-xs text-gray-400 tracking-wider">
            {phase === "input" && "Protocol upload"}
            {phase === "analyzing" && "Analyzing..."}
            {phase === "results" && `${visibleRisks.length} flags · ${papersRetrieved} papers`}
          </span>
        </div>
      </header>

      {/* Two-panel body */}
      <div className="flex-1 flex overflow-hidden" style={{ height: "calc(100vh - 53px)" }}>

        {/* ── LEFT PANEL ── */}
        <div className="flex-1 overflow-y-auto border-r border-gray-100 p-8">
          <div className="max-w-xl mx-auto flex flex-col gap-6">

            {/* Section heading */}
            <div className="border-b border-gray-100 pb-6">
              <p className="font-mono text-xs text-gray-400 tracking-widest uppercase mb-2">
                {phase === "input" ? "01 · Upload" : phase === "analyzing" ? "Analyzing" : "Results"}
              </p>
              <h1 className="text-2xl font-light text-gray-900 tracking-tight">
                {phase === "input" && "Your experiment protocol"}
                {phase === "analyzing" && "Searching literature..."}
                {phase === "results" && "Risk Analysis"}
              </h1>
            </div>

            {/* ── INPUT STATE ── */}
            {phase === "input" && (
              <>
                {/* Input mode toggle */}
                <div className="flex border border-gray-200">
                  <button
                    onClick={() => setInputMode("file")}
                    className={`flex-1 py-2 text-sm font-medium transition-colors ${
                      inputMode === "file" ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-50"
                    }`}
                  >
                    Upload file
                  </button>
                  <button
                    onClick={() => setInputMode("text")}
                    className={`flex-1 py-2 text-sm font-medium transition-colors ${
                      inputMode === "text" ? "bg-gray-900 text-white" : "text-gray-500 hover:bg-gray-50"
                    }`}
                  >
                    Paste text
                  </button>
                </div>

                {/* File upload */}
                {inputMode === "file" && (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border border-dashed border-gray-300 p-10 text-center cursor-pointer hover:border-gray-500 hover:bg-gray-50 transition-all"
                  >
                    {extracting ? (
                      <p className="font-mono text-xs text-gray-400 tracking-wider">Reading file...</p>
                    ) : file ? (
                      <div className="flex flex-col gap-1">
                        <p className="font-mono text-xs text-green-600 tracking-wider">✓ {file.name}</p>
                        <p className="text-xs text-gray-400">Click to replace</p>
                      </div>
                    ) : (
                      <>
                        <p className="font-mono text-xs text-gray-400 tracking-widest uppercase mb-1">Click to upload protocol</p>
                        <p className="text-xs text-gray-400">PDF · DOCX · TXT</p>
                      </>
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
                    className="w-full border border-gray-200 p-4 text-sm font-light text-gray-800 placeholder-gray-400 focus:outline-none focus:border-gray-400 resize-none"
                    rows={8}
                  />
                )}

                {/* ── SUPPORTING MATERIALS ── */}
                <div className="border border-gray-200 rounded-none overflow-hidden">
                  {/* Header */}
                  <div className="bg-gray-900 px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                      <p className="text-white text-sm font-medium">Add supporting materials</p>
                      <span className="font-mono text-xs text-gray-400 ml-auto">optional</span>
                    </div>
                    <p className="text-gray-400 text-xs font-light mt-1.5 pl-4">
                      The more context you provide, the more specific the risk flags.
                    </p>
                  </div>

                  {/* Upload rows */}
                  <div className="divide-y divide-gray-100">
                    {SUPPLEMENTARY_TYPES.map(type => {
                      const uploaded = !!supplementaryFiles[type.key];
                      return (
                        <div key={type.key} className={`px-5 py-4 flex items-start gap-4 transition-colors ${uploaded ? "bg-green-50" : "hover:bg-gray-50"}`}>
                          <span className="text-lg shrink-0 mt-0.5">{type.icon}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-800 font-medium">{type.label}</p>
                            <p className="text-xs text-gray-400 font-light mt-0.5">{type.hint}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {uploaded && <span className="font-mono text-xs text-green-600">✓</span>}
                            <button
                              onClick={() => supFileRefs.current[type.key]?.click()}
                              className={`font-mono text-xs px-3 py-1.5 border transition-colors ${
                                uploaded
                                  ? "border-green-300 text-green-700 hover:bg-green-100"
                                  : "border-gray-200 text-gray-500 hover:border-gray-400 hover:text-gray-700"
                              }`}
                            >
                              {uploaded ? "Replace" : "Upload"}
                            </button>
                            <input
                              ref={el => { supFileRefs.current[type.key] = el; }}
                              type="file"
                              accept=".txt,.pdf,.docx"
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
                  className="w-full py-4 flex items-center justify-center gap-3 bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 disabled:bg-gray-200 disabled:text-gray-400 transition-all active:scale-[0.99] shadow-sm"
                >
                  {hasInput ? (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8"/>
                        <path d="m21 21-4.35-4.35"/>
                      </svg>
                      Analyze risks from literature
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
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
              <div className="flex flex-col items-center gap-6 py-16">
                <div className="w-8 h-8 border-2 border-gray-900 border-t-transparent rounded-full animate-spin" />
                <div className="text-center">
                  <p className="font-mono text-xs text-gray-400 tracking-widest uppercase">
                    {statusText}
                  </p>
                  <p className="text-sm text-gray-400 font-light mt-2">
                    Typically 20–40 seconds
                  </p>
                </div>
              </div>
            )}

            {/* ── RESULTS STATE ── */}
            {phase === "results" && (
              <>
                {/* Severity summary */}
                <div className="flex gap-4">
                  {["high", "medium", "suggestion"].map(sev => {
                    const count = visibleRisks.filter(r => r.severity === sev).length;
                    if (!count) return null;
                    const cfg = SEVERITY_CONFIG[sev as keyof typeof SEVERITY_CONFIG];
                    return (
                      <span key={sev} className="flex items-center gap-1.5 font-mono text-xs text-gray-600">
                        <span className={`w-2 h-2 rounded-full ${cfg.dot} inline-block`} />
                        {count} {cfg.label.toLowerCase()}
                      </span>
                    );
                  })}
                </div>

                {/* Risk cards */}
                <div className="flex flex-col gap-3">
                  {riskItems.map((item, i) => {
                    if (dismissedRisks.has(i)) return null;
                    const cfg = SEVERITY_CONFIG[item.severity] || SEVERITY_CONFIG.suggestion;
                    return (
                      <div key={i} className={`border-l-4 ${cfg.borderColor} ${cfg.bg} p-4 flex flex-col gap-2`}>
                        <div className="flex justify-between items-start">
                          <div className="flex flex-col gap-1">
                            <span className={`font-mono text-xs px-2 py-0.5 self-start ${cfg.badge}`}>
                              {cfg.label}
                            </span>
                            <p className={`font-medium text-sm ${cfg.titleColor}`}>{item.risk}</p>
                          </div>
                          <button
                            onClick={() => setDismissedRisks(prev => new Set([...prev, i]))}
                            className="font-mono text-xs text-gray-400 hover:text-gray-600 ml-4 shrink-0"
                          >
                            Dismiss
                          </button>
                        </div>
                        <p className="text-sm font-light text-gray-700">{item.explanation}</p>
                        <div className="border border-gray-200 bg-white px-3 py-2">
                          <p className="font-mono text-xs text-gray-400 uppercase tracking-wider mb-1">Suggestion</p>
                          <p className="text-sm text-gray-700 font-light">{item.suggestion}</p>
                        </div>
                        {item.sources.length > 0 && (
                          <div className="flex flex-col gap-1">
                            <p className="font-mono text-xs text-gray-400 uppercase tracking-wider">Sources</p>
                            {item.sources.map((s, j) => (
                              <div key={j} className="flex items-start gap-1.5">
                                <span className="font-mono text-xs text-gray-400">[{j + 1}]</span>
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

                  {visibleRisks.length === 0 && (
                    <div className="border border-green-100 bg-green-50 p-4">
                      <p className="text-sm text-green-700 font-light">✓ No significant risks flagged.</p>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-3 border-t border-gray-100 pt-4">
                  <button
                    onClick={() => {
                      setPhase("input");
                      setRiskItems([]);
                      setFile(null);
                      setExtractedText("");
                      setTextInput("");
                      setDismissedRisks(new Set());
                    }}
                    className="flex-1 py-2.5 border border-gray-200 text-gray-600 text-sm hover:bg-gray-50 transition-colors"
                  >
                    New analysis
                  </button>
                  <button
                    onClick={handleExportPDF}
                    className="flex-1 py-2.5 bg-gray-900 text-white text-sm hover:bg-gray-700 transition-colors"
                  >
                    Export PDF
                  </button>
                </div>
              </>
            )}

          </div>
        </div>

        {/* ── RIGHT PANEL — CHAT ── */}
        <div className="w-96 shrink-0 flex flex-col bg-white border-l border-gray-100">

          {/* Chat header */}
          <div className="border-b border-gray-200 px-5 py-4 shrink-0 bg-white">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <p className="text-sm font-medium text-gray-900">Your personal lab design assistant</p>
            </div>
            <p className="text-xs text-gray-400 font-light pl-4">
              {phase === "results"
                ? "Ask about any risk flag, or request protocol changes by voice or text"
                : "Tell me about your experiment to improve the analysis — or skip and click Analyze"}
            </p>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-xs text-sm px-3 py-2.5 ${
                  msg.role === "user"
                    ? "bg-gray-900 text-white"
                    : "bg-white text-gray-700 border border-gray-200"
                }`}
                  style={{ whiteSpace: "pre-wrap" }}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {(chatLoading || voiceLoading) && (
              <div className="flex justify-start">
                <div className="bg-white border border-gray-200 px-3 py-2.5 text-sm text-gray-400">
                  {voiceLoading ? "Transcribing..." : "Thinking..."}
                </div>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Chat input */}
          <div className="border-t border-gray-200 p-4 shrink-0 bg-white">

            {/* Voice button — large, primary */}
            <button
              onClick={toggleRecording}
              disabled={chatLoading || voiceLoading}
              className={`w-full py-3.5 flex items-center justify-center gap-3 text-sm font-medium transition-all mb-3 ${
                isRecording
                  ? "bg-red-500 text-white shadow-lg shadow-red-200 scale-[1.02]"
                  : voiceLoading
                  ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                  : chatLoading
                  ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                  : "bg-gray-900 text-white hover:bg-gray-700 active:scale-[0.98]"
              }`}
              title={isRecording ? "Click to stop recording" : "Click to speak"}
            >
              {isRecording ? (
                <>
                  <span className="w-3 h-3 rounded-sm bg-white inline-block" />
                  Stop recording
                  <span className="font-mono text-xs opacity-60 ml-1 animate-pulse">●</span>
                </>
              ) : voiceLoading ? (
                <>
                  <span className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin inline-block" />
                  Transcribing...
                </>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
            <div className="flex gap-2 items-end">
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
                className="flex-1 border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-gray-400 resize-none bg-gray-50"
                rows={1}
                style={{ maxHeight: 80 }}
              />
              <button
                onClick={() => sendChatMessage(chatInput)}
                disabled={chatLoading || !chatInput.trim()}
                className="px-4 py-2 bg-gray-900 text-white text-sm hover:bg-gray-700 disabled:bg-gray-200 disabled:text-gray-400 transition-colors shrink-0"
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
