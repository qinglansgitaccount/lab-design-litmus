"use client";
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";

export default function LandingPage() {
  const [showModal, setShowModal] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [form, setForm] = useState({ name: "", email: "", area: "", role: "" });

  // Intersection observer for fade-in animations
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) entry.target.classList.add("visible");
        });
      },
      { threshold: 0.1 }
    );
    document.querySelectorAll(".fade-in, .step").forEach(el => observer.observe(el));
    document.querySelectorAll<HTMLElement>(".step").forEach((step, i) => {
      step.style.transitionDelay = `${i * 0.1}s`;
    });
    return () => observer.disconnect();
  }, []);

  // Lock scroll when modal open
  useEffect(() => {
    document.body.style.overflow = showModal ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [showModal]);

  // Keyboard close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setShowModal(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const handleSubmit = async () => {
    const { name, email, area, role } = form;
    if (!name || !email || !area || !role) {
      setFormError("Please fill in all fields.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFormError("Please enter a valid email address.");
      return;
    }
    setFormError("");
    setIsSubmitting(true);

    const { error } = await supabase.from("access_requests").insert([{
      name, email, research_area: area, role
    }]);

    setIsSubmitting(false);
    if (error) {
      setFormError("Something went wrong. Please try again.");
      return;
    }
    setIsSuccess(true);
  };

  return (
    <>
      {/* Google Fonts */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link
        href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Mono:wght@400;500&family=DM+Sans:wght@300;400;500&display=swap"
        rel="stylesheet"
      />

      {/* Scoped styles */}
      <style>{`
        .landing-root {
          background: #0c0e0f;
          color: #e8e6e0;
          font-family: 'DM Sans', sans-serif;
          font-size: 16px;
          line-height: 1.6;
          font-weight: 300;
          min-height: 100vh;
          overflow-x: hidden;
          position: relative;
        }
        .landing-root::before {
          content: '';
          position: fixed;
          inset: 0;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E");
          pointer-events: none;
          z-index: 0;
          opacity: 0.4;
        }
        .l-container {
          max-width: 860px;
          margin: 0 auto;
          padding: 0 24px;
          position: relative;
          z-index: 1;
        }
        .l-nav {
          padding: 24px 0;
          border-bottom: 1px solid rgba(255,255,255,0.08);
          position: relative;
          z-index: 1;
        }
        .l-nav .l-container {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .l-logo {
          font-family: 'DM Mono', monospace;
          font-size: 13px;
          color: #c8f0a0;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .l-nav-badge {
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          color: #5a5855;
          border: 1px solid rgba(255,255,255,0.08);
          padding: 4px 10px;
          border-radius: 2px;
          letter-spacing: 0.06em;
        }
        .l-hero {
          padding: 100px 0 80px;
          position: relative;
        }
        .l-hero-eyebrow {
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          color: #c8f0a0;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          margin-bottom: 28px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .l-hero-eyebrow::before {
          content: '';
          display: block;
          width: 24px;
          height: 1px;
          background: #c8f0a0;
        }
        .l-hero h1 {
          font-family: 'Instrument Serif', Georgia, serif;
          font-size: clamp(38px, 6vw, 58px);
          font-weight: 400;
          line-height: 1.15;
          color: #e8e6e0;
          margin-bottom: 28px;
          letter-spacing: -0.01em;
        }
        .l-hero h1 em {
          font-style: italic;
          color: #8a8780;
        }
        .l-hero-sub {
          font-size: 17px;
          color: #8a8780;
          max-width: 560px;
          line-height: 1.7;
          margin-bottom: 44px;
          font-weight: 300;
        }
        .l-hero-sub strong { color: #e8e6e0; font-weight: 400; }
        .l-cta-btn {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          background: #c8f0a0;
          color: #0c0e0f;
          font-family: 'DM Sans', sans-serif;
          font-size: 14px;
          font-weight: 500;
          padding: 14px 28px;
          border-radius: 3px;
          text-decoration: none;
          letter-spacing: 0.02em;
          transition: background 0.2s, transform 0.15s;
          border: none;
          cursor: pointer;
        }
        .l-cta-btn:hover { background: #a0d878; transform: translateY(-1px); }
        .l-cta-note {
          margin-top: 14px;
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          color: #5a5855;
          letter-spacing: 0.06em;
        }
        .l-section {
          padding: 80px 0;
          border-top: 1px solid rgba(255,255,255,0.08);
          position: relative;
          z-index: 1;
        }
        .l-section-label {
          font-family: 'DM Mono', monospace;
          font-size: 10px;
          color: #5a5855;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          margin-bottom: 48px;
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .l-section-label::after {
          content: '';
          flex: 1;
          height: 1px;
          background: rgba(255,255,255,0.08);
        }
        .l-steps { display: flex; flex-direction: column; gap: 0; }
        .step {
          display: grid;
          grid-template-columns: 48px 1fr;
          gap: 0 24px;
          padding: 28px 0;
          border-bottom: 1px solid rgba(255,255,255,0.08);
          opacity: 0;
          transform: translateY(16px);
          transition: opacity 0.5s ease, transform 0.5s ease;
        }
        .step.visible { opacity: 1; transform: none; }
        .step:last-child { border-bottom: none; }
        .l-step-num {
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          color: #5a5855;
          padding-top: 4px;
          letter-spacing: 0.06em;
        }
        .l-step-content h3 {
          font-family: 'DM Sans', sans-serif;
          font-size: 16px;
          font-weight: 500;
          color: #e8e6e0;
          margin-bottom: 8px;
        }
        .l-step-content p { font-size: 14px; color: #8a8780; line-height: 1.65; }
        .l-step-content p strong { color: #e8e6e0; font-weight: 400; }
        .l-step-tag {
          display: inline-block;
          margin-top: 10px;
          font-family: 'DM Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.08em;
          padding: 3px 8px;
          border-radius: 2px;
          background: rgba(200,240,160,0.08);
          color: #c8f0a0;
          border: 1px solid rgba(200,240,160,0.15);
        }
        .l-case-card {
          background: #131618;
          border: 1px solid rgba(255,255,255,0.14);
          border-radius: 4px;
          overflow: hidden;
        }
        .l-case-header {
          background: #1a1d1f;
          padding: 20px 28px;
          border-bottom: 1px solid rgba(255,255,255,0.08);
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .l-cost-badge {
          font-family: 'DM Mono', monospace;
          font-size: 12px;
          color: #f08070;
          background: rgba(240,128,112,0.08);
          border: 1px solid rgba(240,128,112,0.2);
          padding: 4px 10px;
          border-radius: 2px;
          letter-spacing: 0.06em;
        }
        .l-case-title {
          font-family: 'DM Mono', monospace;
          font-size: 12px;
          color: #8a8780;
          letter-spacing: 0.06em;
        }
        .l-case-body { padding: 32px 28px; }
        .l-case-body p { font-size: 15px; color: #8a8780; line-height: 1.75; margin-bottom: 20px; }
        .l-case-body p:last-of-type { margin-bottom: 0; }
        .l-case-body strong { color: #e8e6e0; font-weight: 400; }
        .l-case-highlight {
          margin-top: 28px;
          padding: 20px 24px;
          background: rgba(200,240,160,0.04);
          border-left: 2px solid #c8f0a0;
          border-radius: 0 3px 3px 0;
        }
        .l-case-highlight p {
          font-family: 'Instrument Serif', Georgia, serif;
          font-style: italic;
          font-size: 17px;
          color: #e8e6e0;
          line-height: 1.6;
          margin-bottom: 0;
        }
        .l-trust-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1px;
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 4px;
          overflow: hidden;
          margin-bottom: 40px;
        }
        .l-trust-item { background: #131618; padding: 28px; }
        .l-trust-item h3 {
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          color: #c8f0a0;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          margin-bottom: 12px;
        }
        .l-trust-item p { font-size: 14px; color: #8a8780; line-height: 1.65; }
        .l-trust-item p strong { color: #e8e6e0; font-weight: 400; }
        .l-sources-row {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 16px 20px;
          background: #131618;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 3px;
        }
        .l-sources-label {
          font-family: 'DM Mono', monospace;
          font-size: 10px;
          color: #5a5855;
          letter-spacing: 0.1em;
          white-space: nowrap;
        }
        .l-source-pill {
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          color: #8a8780;
          background: #1a1d1f;
          border: 1px solid rgba(255,255,255,0.14);
          padding: 4px 12px;
          border-radius: 2px;
          letter-spacing: 0.04em;
        }
        .l-final-cta { text-align: center; padding: 80px 0 100px; border-top: 1px solid rgba(255,255,255,0.08); }
        .l-final-cta h2 {
          font-family: 'Instrument Serif', Georgia, serif;
          font-size: clamp(28px, 4vw, 40px);
          font-weight: 400;
          margin-bottom: 16px;
          line-height: 1.25;
          color: #e8e6e0;
        }
        .l-final-cta p { color: #8a8780; font-size: 15px; margin-bottom: 40px; max-width: 420px; margin-left: auto; margin-right: auto; }
        .l-footer {
          border-top: 1px solid rgba(255,255,255,0.08);
          padding: 24px 0;
          position: relative;
          z-index: 1;
        }
        .l-footer .l-container { display: flex; align-items: center; justify-content: space-between; }
        .l-footer p { font-family: 'DM Mono', monospace; font-size: 11px; color: #5a5855; letter-spacing: 0.06em; }
        .fade-in {
          opacity: 0;
          transform: translateY(20px);
          transition: opacity 0.6s ease, transform 0.6s ease;
        }
        .fade-in.visible { opacity: 1; transform: none; }
        .l-flag-box {
          padding: 20px;
          background: #1a1d1f;
          border-radius: 3px;
        }
        .l-flag-meta {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 10px;
        }
        .l-flag-label {
          font-family: 'DM Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }
        .l-flag-sublabel {
          font-family: 'DM Mono', monospace;
          font-size: 10px;
          color: #5a5855;
        }
        .l-flag-title { font-size: 14px; color: #e8e6e0; margin-bottom: 8px; font-weight: 400; }
        .l-flag-desc { font-size: 13px; color: #8a8780; line-height: 1.6; }
        .l-flag-link {
          display: inline-block;
          margin-top: 12px;
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          color: #c8f0a0;
          text-decoration: none;
          border-bottom: 1px solid rgba(200,240,160,0.3);
        }
        .l-form-input {
          width: 100%;
          background: #1a1d1f;
          border: 1px solid rgba(255,255,255,0.14);
          border-radius: 3px;
          padding: 10px 14px;
          color: #e8e6e0;
          font-family: 'DM Sans', sans-serif;
          font-size: 14px;
          outline: none;
          transition: border-color 0.15s;
          font-weight: 300;
        }
        .l-form-input:focus { border-color: rgba(200,240,160,0.4); }
        .l-form-input option { background: #1a1d1f; }
        @media (max-width: 600px) {
          .l-trust-grid { grid-template-columns: 1fr; }
          .l-sources-row { flex-wrap: wrap; }
          .l-hero { padding: 60px 0 60px; }
          .l-section { padding: 60px 0; }
        }
      `}</style>

      <div className="landing-root">

        {/* NAV */}
        <nav className="l-nav">
          <div className="l-container">
            <span className="l-logo">Lab Design Litmus</span>
            <span className="l-nav-badge">Early Access for PhD Students</span>
          </div>
        </nav>

        {/* HERO */}
        <section className="l-hero" style={{ borderTop: "none" }}>
          <div className="l-container">
            <div className="l-hero-eyebrow">Experiment Design Review</div>
            <h1>
              Flag flaws in your experiment design<br />
              <em>before they cost you.</em>
            </h1>
            <p className="l-hero-sub">
              Share your experiment design. Get a risk analysis{" "}
              <strong>backed by real published literature</strong> — with citations you can click and verify yourself.
            </p>
            <button className="l-cta-btn" onClick={() => setShowModal(true)}>
              Request access
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <p className="l-cta-note">Early access · Reviewed within 48 hours</p>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section className="l-section">
          <div className="l-container">
            <div className="l-section-label">How it works</div>
            <div className="l-steps">

              <div className="step">
                <span className="l-step-num">01</span>
                <div className="l-step-content">
                  <h3>Tell us about your experiment</h3>
                  <p>
                    Upload a protocol draft, describe your setup in plain language, or both. You can also add supporting
                    materials — a relevant publication, instrument specs, or your lab's prior work on this topic.{" "}
                    <strong>The more context you give, the more specific the analysis.</strong>
                  </p>
                  <span className="l-step-tag">PDF · DOCX · voice · plain text</span>
                </div>
              </div>

              <div className="step">
                <span className="l-step-num">02</span>
                <div className="l-step-content">
                  <h3>We search the literature on your behalf</h3>
                  <p>
                    Your experiment design is cross-referenced against PubMed and Semantic Scholar in real time. We look
                    for{" "}
                    <strong>known failure modes, missing controls, parameter edge cases, and reagent-specific issues</strong>{" "}
                    — the things that don't always make it into the methods section.
                  </p>
                  <span className="l-step-tag">PubMed · Semantic Scholar · real-time</span>
                </div>
              </div>

              <div className="step">
                <span className="l-step-num">03</span>
                <div className="l-step-content">
                  <h3>You get specific risk flags — and you verify them</h3>
                  <p>
                    Each flag links to the paper it came from.{" "}
                    <strong>Click through and read the source yourself.</strong> We're not here to replace your judgment —
                    we're here to save you the hours it would take to find these papers on your own.
                  </p>
                  <span className="l-step-tag">clickable citations · verify everything</span>
                </div>
              </div>

            </div>
          </div>
        </section>

        {/* SAMPLE OUTPUT */}
        <section className="l-section">
          <div className="l-container">
            <div className="l-section-label">What you get</div>

            <div className="l-case-card fade-in">
              <div className="l-case-header">
                <span className="l-cost-badge">Sample output</span>
                <span className="l-case-title">Western blot · knockdown validation</span>
              </div>
              <div className="l-case-body">
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

                  <div className="l-flag-box" style={{ borderLeft: "2px solid #f08070" }}>
                    <div className="l-flag-meta">
                      <span className="l-flag-label" style={{ color: "#f08070" }}>Risk flag 01</span>
                      <span className="l-flag-sublabel">Antibody validation</span>
                    </div>
                    <p className="l-flag-title">No antibody validation step detected in protocol.</p>
                    <p className="l-flag-desc">
                      Commercial antibodies for this target have documented off-target binding in this cell line. Without a
                      validation blot or positive control, false positives are likely.
                    </p>
                    <a href="#" className="l-flag-link">
                      → Uhlen et al. (2016) · Science · PMID 27708640
                    </a>
                  </div>

                  <div className="l-flag-box" style={{ borderLeft: "2px solid #f0c060" }}>
                    <div className="l-flag-meta">
                      <span className="l-flag-label" style={{ color: "#f0c060" }}>Risk flag 02</span>
                      <span className="l-flag-sublabel">Loading control</span>
                    </div>
                    <p className="l-flag-title">β-actin used as loading control may be unreliable for this experiment.</p>
                    <p className="l-flag-desc">
                      β-actin expression is altered under the treatment conditions described. Literature recommends total
                      protein normalization or an alternative housekeeping gene for this assay type.
                    </p>
                    <a href="#" className="l-flag-link">
                      → Dittmer & Dittmer (2006) · BioTechniques · PMID 17008315
                    </a>
                  </div>

                  <div className="l-flag-box" style={{ borderLeft: "2px solid rgba(255,255,255,0.15)" }}>
                    <div className="l-flag-meta">
                      <span className="l-flag-label" style={{ color: "#8a8780" }}>Suggestion</span>
                      <span className="l-flag-sublabel">Sample size</span>
                    </div>
                    <p className="l-flag-title">3 biological replicates may be underpowered to detect a 2-fold change.</p>
                    <p className="l-flag-desc">
                      Based on reported variance for this assay type, published power analyses suggest n ≥ 4 for 80% power
                      at α = 0.05.
                    </p>
                    <a href="#" className="l-flag-link">
                      → Vaux et al. (2012) · Nature Methods · PMID 22930834
                    </a>
                  </div>

                </div>

                <div className="l-case-highlight" style={{ marginTop: 24 }}>
                  <p>Every flag links to the paper it came from. Click through. Read it. Ignore anything that doesn't apply to your setup.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* TRUST */}
        <section className="l-section">
          <div className="l-container">
            <div className="l-section-label">A few things worth saying directly</div>

            <div className="l-trust-grid fade-in">
              <div className="l-trust-item">
                <h3>On citation quality</h3>
                <p>
                  Every risk flag is grounded in a real retrieved paper — not generated from memory. If a citation doesn't
                  hold up when you click it, <strong>ignore that flag</strong>. We'd rather you verify and discard than
                  trust blindly.
                </p>
              </div>
              <div className="l-trust-item">
                <h3>On AI judgment</h3>
                <p>
                  We don't make decisions for you. We surface things worth checking.{" "}
                  <strong>You are the scientist.</strong> This tool is faster than searching PubMed yourself — it's not
                  smarter than you.
                </p>
              </div>
              <div className="l-trust-item">
                <h3>On what we catch</h3>
                <p>
                  Logical gaps in your experimental design. Known failure modes for your assay type. Parameter ranges that
                  deviate from established practice.{" "}
                  <strong>Missing controls that literature suggests are necessary.</strong>
                </p>
              </div>
              <div className="l-trust-item">
                <h3>On what we don't catch</h3>
                <p>
                  Everything specific to your lab's conditions, your PI's intuition, and the tacit knowledge in your
                  department. This tool works best as{" "}
                  <strong>a first pass before you talk to your advisor</strong> — not a replacement for that conversation.
                </p>
              </div>
            </div>

            <div className="l-sources-row fade-in">
              <span className="l-sources-label">Literature sources</span>
              <span className="l-source-pill">PubMed / NCBI</span>
              <span className="l-source-pill">Semantic Scholar</span>
              <span className="l-source-pill">Real-time retrieval</span>
              <span className="l-source-pill">DOI links included</span>
            </div>
          </div>
        </section>

        {/* FINAL CTA */}
        <section className="l-final-cta">
          <div className="l-container">
            <h2>Ready to stress-test your experiment design?</h2>
            <p>Takes about 5 minutes. Upload a protocol or just describe what you're planning.</p>
            <button className="l-cta-btn" onClick={() => setShowModal(true)}>
              Request access
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <p className="l-cta-note" style={{ marginTop: 16 }}>Free · Early access for PhD researchers</p>
          </div>
        </section>

        {/* FOOTER */}
        <footer className="l-footer">
          <div className="l-container">
            <p className="l-logo" style={{ fontSize: 11 }}>Lab Design Litmus</p>
            <p>Early access · Feedback welcome</p>
          </div>
        </footer>

        {/* MODAL */}
        {showModal && (
          <div
            style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
              zIndex: 100, display: "flex", alignItems: "center",
              justifyContent: "center", padding: 24,
            }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}
          >
            <div style={{
              background: "#131618",
              border: "1px solid rgba(255,255,255,0.14)",
              borderRadius: 6,
              maxWidth: 460, width: "100%", padding: 36,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
                <div>
                  <div style={{
                    fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#c8f0a0",
                    letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8,
                  }}>
                    Request access
                  </div>
                  <h3 style={{
                    fontFamily: "'Instrument Serif', Georgia, serif",
                    fontSize: 22, fontWeight: 400, color: "#e8e6e0", lineHeight: 1.3,
                  }}>
                    Tell us a bit about your research
                  </h3>
                </div>
                <button
                  onClick={() => setShowModal(false)}
                  style={{ background: "none", border: "none", color: "#5a5855", cursor: "pointer", fontSize: 20, padding: 0, lineHeight: 1, marginLeft: 16 }}
                >
                  ✕
                </button>
              </div>

              {!isSuccess ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

                  {[
                    { id: "name", label: "Name", type: "text", placeholder: "Your name", key: "name" as const },
                    { id: "email", label: "Email", type: "email", placeholder: "your@university.edu", key: "email" as const },
                    { id: "area", label: "Research area", type: "text", placeholder: "e.g. cancer biology, organic chemistry", key: "area" as const },
                  ].map(field => (
                    <div key={field.id}>
                      <label style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#5a5855", letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                        {field.label}
                      </label>
                      <input
                        type={field.type}
                        placeholder={field.placeholder}
                        value={form[field.key]}
                        onChange={e => setForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                        className="l-form-input"
                      />
                    </div>
                  ))}

                  <div>
                    <label style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#5a5855", letterSpacing: "0.1em", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                      Current role
                    </label>
                    <select
                      value={form.role}
                      onChange={e => setForm(prev => ({ ...prev, role: e.target.value }))}
                      className="l-form-input"
                      style={{ cursor: "pointer" }}
                    >
                      <option value="" disabled>Select your role</option>
                      <option value="undergrad">Undergraduate researcher</option>
                      <option value="phd-early">PhD student, early stage (years 1–3)</option>
                      <option value="phd-late">PhD student, advanced (years 4+)</option>
                      <option value="postdoc">Postdoc</option>
                      <option value="industry">Research scientist / industry</option>
                      <option value="other">Other</option>
                    </select>
                  </div>

                  {formError && (
                    <p style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#f08070", letterSpacing: "0.04em" }}>
                      {formError}
                    </p>
                  )}

                  <button
                    onClick={handleSubmit}
                    disabled={isSubmitting}
                    style={{
                      width: "100%", background: isSubmitting ? "#8a8780" : "#c8f0a0",
                      color: "#0c0e0f", fontFamily: "'DM Sans', sans-serif",
                      fontSize: 14, fontWeight: 500, padding: 13,
                      borderRadius: 3, border: "none", cursor: isSubmitting ? "not-allowed" : "pointer",
                      marginTop: 4, transition: "background 0.2s",
                    }}
                  >
                    {isSubmitting ? "Submitting..." : "Request access →"}
                  </button>

                  <p style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "#5a5855", textAlign: "center", letterSpacing: "0.06em" }}>
                    We'll review and send you a link within 48 hours.
                  </p>
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: "20px 0" }}>
                  <div style={{ fontSize: 32, marginBottom: 16 }}>✓</div>
                  <h3 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 22, fontWeight: 400, color: "#e8e6e0", marginBottom: 12 }}>
                    You're on the list.
                  </h3>
                  <p style={{ fontSize: 14, color: "#8a8780", lineHeight: 1.65 }}>
                    We'll review your request and send you access within 48 hours. Check your inbox — including spam.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </>
  );
}
