"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const options = [
  {
    number: "01",
    href: "/setup/upload",
    title: "Upload protocol",
    description: "Parse your written protocol automatically. Includes optional literature-grounded risk analysis.",
    tag: "PDF · DOCX · TXT",
  },
  {
    number: "02",
    href: "/setup/voice",
    title: "Describe verbally",
    description: "Tell the agent about your experiment by voice. Works in one shot or through guided questions.",
    tag: "Voice input",
  },
  {
    number: "03",
    href: null,
    title: "Start directly",
    description: "Jump straight into recording. Name sub-experiments and define fields as you go.",
    tag: "Instant start",
  },
];

export default function SetupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const startDirectly = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/setup/direct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      router.push(
        `/experiment/${data.experiment_id}?subs=${encodeURIComponent(JSON.stringify(data.sub_experiments))}`
      );
    } catch (e) {
      alert("Something went wrong — check if backend is running");
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-white flex flex-col">

      {/* Top bar */}
      <header className="border-b border-gray-100 px-8 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3 hover:opacity-70 transition-opacity">
          <div className="w-6 h-6 rounded-full border-2 border-gray-900" />
          <span className="font-mono text-sm font-medium tracking-widest uppercase text-gray-900">
            Lab Copilot
          </span>
        </Link>
        <span className="font-mono text-xs text-gray-400 tracking-wider">New experiment</span>
      </header>

      {/* Content */}
      <section className="flex-1 flex flex-col items-center justify-center px-8 py-16">
        <div className="w-full max-w-2xl">

          {/* Heading */}
          <div className="mb-12 border-b border-gray-100 pb-8">
            <p className="font-mono text-xs text-gray-400 tracking-widest uppercase mb-3">Setup</p>
            <h1 className="text-3xl font-light text-gray-900 tracking-tight">
              How would you like to begin?
            </h1>
          </div>

          {/* Options */}
          <div className="flex flex-col divide-y divide-gray-100">
            {options.map((opt) => (
              <div
                key={opt.number}
                onClick={() => {
                  if (opt.href) router.push(opt.href);
                  else startDirectly();
                }}
                className="group flex items-start gap-8 py-8 cursor-pointer hover:bg-gray-50 -mx-6 px-6 transition-colors"
              >
                {/* Number */}
                <span className="font-mono text-xs text-gray-300 mt-1 w-6 shrink-0 group-hover:text-gray-500 transition-colors">
                  {opt.number}
                </span>

                {/* Content */}
                <div className="flex-1 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-medium text-gray-900 group-hover:text-gray-700">
                      {opt.number === "03" && loading ? "Setting up..." : opt.title}
                    </h2>
                    <span className="font-mono text-xs text-gray-400 group-hover:text-gray-500 transition-colors">
                      {opt.tag}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 font-light leading-relaxed">
                    {opt.description}
                  </p>
                </div>

                {/* Arrow */}
                <span className="text-gray-300 group-hover:text-gray-700 transition-colors mt-0.5 text-lg">
                  →
                </span>
              </div>
            ))}
          </div>

        </div>
      </section>

    </main>
  );
}