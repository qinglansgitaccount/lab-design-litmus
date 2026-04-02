"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import RiskChat from "@/components/RiskChat";

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

export default function UploadSetupPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [riskLoading, setRiskLoading] = useState(false);
  const [experimentData, setExperimentData] = useState<any>(null);
  const [protocolText, setProtocolText] = useState("");
  const [riskItems, setRiskItems] = useState<RiskItem[]>([]);
  const [dismissedRisks, setDismissedRisks] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState("");
  const [papersRetrieved, setPapersRetrieved] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) setFile(e.target.files[0]);
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

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    setExperimentData(null);
    setRiskItems([]);
    setDismissedRisks(new Set());
    setProtocolText("");

    try {
      setStatus("Reading protocol...");
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("${process.env.NEXT_PUBLIC_API_URL}/setup/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      setExperimentData(data);
      setProtocolText(data.design_text || data.title || "");
      setStatus("");
    } catch (e) {
      setStatus("Error — check if backend is running");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = () => {
    if (!experimentData) return;
    router.push(
      `/experiment/${experimentData.experiment_id}?subs=${encodeURIComponent(
        JSON.stringify(experimentData.sub_experiments)
      )}`
    );
  };

  const dismissRisk = (i: number) => {
    setDismissedRisks(prev => new Set([...prev, i]));
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
        <span className="font-mono text-xs text-gray-400 tracking-wider">Upload protocol</span>
      </header>

      <section className="flex-1 flex flex-col items-center py-16 px-8">
        <div className="w-full max-w-2xl flex flex-col gap-8">

          {/* Heading */}
          <div className="border-b border-gray-100 pb-8">
            <p className="font-mono text-xs text-gray-400 tracking-widest uppercase mb-3">01 · Upload</p>
            <h1 className="text-3xl font-light text-gray-900 tracking-tight">Upload your protocol</h1>
            <p className="text-sm text-gray-500 font-light mt-2">
              Claude will parse your experiment structure. You can optionally run literature-grounded risk analysis.
            </p>
          </div>

          {/* Upload area */}
          {!experimentData && (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="w-full border border-dashed border-gray-300 p-16 text-center cursor-pointer hover:border-gray-500 hover:bg-gray-50 transition-all"
            >
              <p className="font-mono text-xs text-gray-400 tracking-widest uppercase mb-3">
                {file ? file.name : "Click to select file"}
              </p>
              <p className="text-sm text-gray-400 font-light">Supports .txt · .pdf · .docx</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.pdf,.docx"
                onChange={handleFile}
                className="hidden"
              />
            </div>
          )}

          {file && !experimentData && (
            <button
              onClick={handleUpload}
              disabled={loading}
              className="w-full py-3 bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 disabled:bg-gray-300 transition-colors"
            >
              {loading ? status : "Analyze Protocol"}
            </button>
          )}

          {/* Parsed structure */}
          {experimentData && (
            <div className="w-full border border-gray-100 p-6 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <p className="font-mono text-xs text-gray-400 tracking-widest uppercase">Parsed structure</p>
                <button
                  onClick={() => {
                    setFile(null);
                    setExperimentData(null);
                    setRiskItems([]);
                    setDismissedRisks(new Set());
                    setProtocolText("");
                  }}
                  className="font-mono text-xs text-gray-400 hover:text-gray-700 transition-colors"
                >
                  Re-upload
                </button>
              </div>
              <p className="font-medium text-gray-900">{experimentData.title}</p>
              <div className="flex flex-col gap-2">
                {experimentData.sub_experiments.map((sub: any) => (
                  <div key={sub.id} className="flex items-start justify-between border-l-2 border-gray-200 pl-4 py-1">
                    <p className="text-sm text-gray-700">{sub.name}</p>
                    <p className="text-xs text-gray-400 font-mono ml-4">
                      {sub.fields.length > 0 ? sub.fields.join(" · ") : "no fields"}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Optional risk analysis trigger */}
          {experimentData && !riskLoading && riskItems.length === 0 && (
            <button
              onClick={() => runRiskAnalysis(
                experimentData.design_text || experimentData.title,
                experimentData.experiment_id
              )}
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
              experimentId={experimentData?.experiment_id || null}
              onProtocolUpdate={(updated) => setProtocolText(updated)}
              onRiskRerun={(updated) => runRiskAnalysis(updated, experimentData.experiment_id)}
            />
          )}

          {/* Confirm */}
          {experimentData && (
            <button
              onClick={handleConfirm}
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