import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-white flex flex-col">

      {/* Top bar */}
      <header className="border-b border-gray-100 px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-full border-2 border-gray-900" />
          <span className="font-mono text-sm font-medium tracking-widest uppercase text-gray-900">
            Lab Copilot
          </span>
        </div>
        <span className="font-mono text-xs text-gray-400 tracking-wider">v0.1 · MVP</span>
      </header>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-10">

        {/* Decorative cross */}
        <div className="relative w-16 h-16 flex items-center justify-center">
          <div className="absolute w-px h-16 bg-gray-200" />
          <div className="absolute w-16 h-px bg-gray-200" />
          <div className="w-2 h-2 rounded-full bg-gray-900" />
        </div>

        <div className="max-w-xl flex flex-col gap-5">
          <h1 className="text-4xl font-light tracking-tight text-gray-900 leading-tight">
            Your AI-powered
            <br />
            <span className="font-medium">experiment assistant</span>
          </h1>
          <p className="text-base text-gray-500 font-light leading-relaxed">
            Voice-first data recording, real-time documentation, and
            literature-grounded risk analysis — designed for researchers
            who can't stop to type.
          </p>
        </div>

        <div className="flex flex-col items-center gap-4">
          <Link
            href="/setup"
            className="px-8 py-3 bg-gray-900 text-white text-sm font-medium tracking-wide hover:bg-gray-700 transition-colors"
          >
            New Experiment
          </Link>
          <span className="font-mono text-xs text-gray-400 tracking-wider">
            Voice · Image · Export · Risk Analysis
          </span>
        </div>

      </section>

      {/* Bottom bar */}
      <footer className="border-t border-gray-100 px-8 py-4 flex items-center justify-between">
        <span className="font-mono text-xs text-gray-400">
          Daika AI · 2025
        </span>
        <div className="flex items-center gap-6">
          {["Voice recording", "Claude Vision", "RAG risk flags", "PDF export"].map(f => (
            <span key={f} className="font-mono text-xs text-gray-400">{f}</span>
          ))}
        </div>
      </footer>

    </main>
  );
}