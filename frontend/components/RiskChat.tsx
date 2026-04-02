"use client";
import { useState, useRef } from "react";

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

type Props = {
  protocolText: string;
  riskItems: RiskItem[];
  experimentId: string | null;
  onProtocolUpdate: (updatedProtocol: string) => void;
  onRiskRerun: (newProtocol: string) => void;
};

export default function RiskChat({ protocolText, riskItems, experimentId, onProtocolUpdate, onRiskRerun }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Ask me about any of the risks above, or request protocol changes — e.g. 'Why is OD600 linearity a concern?' or 'Change incubation temperature to 30°C'." }
  ]);
  const [history, setHistory] = useState<{ role: string; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return;
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: text }]);
    setLoading(true);

    try {
      const res = await fetch("${process.env.NEXT_PUBLIC_API_URL}/risk/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          protocol_text: protocolText,
          risk_items: riskItems,
          conversation_history: history,
          experiment_id: experimentId
        })
      });
      const data = await res.json();

      setMessages(prev => [...prev, { role: "assistant", content: data.content }]);
      setHistory(prev => [
        ...prev,
        { role: "user", content: text },
        { role: "assistant", content: data.content }
      ]);

      if (data.type === "protocol_update") {
        onProtocolUpdate(data.updated_protocol);
        // Auto re-run risk analysis with updated protocol
        setTimeout(() => onRiskRerun(data.updated_protocol), 500);
      }

    } catch (e) {
      setMessages(prev => [...prev, { role: "assistant", content: "Error — check if backend is running." }]);
    } finally {
      setLoading(false);
    }
  };

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
        stream.getTracks().forEach(t => t.stop());
        try {
          const formData = new FormData();
          formData.append("audio", blob, "recording.webm");
          const res = await fetch("${process.env.NEXT_PUBLIC_API_URL}/transcribe", {
            method: "POST",
            body: formData,
          });
          const { text } = await res.json();
          setLoading(false);
          await sendMessage(text);
        } catch (e) {
          setLoading(false);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    }
  };

  return (
    <div className="w-full border border-gray-200 rounded-none">
      {/* Header */}
      <div className="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
        <span className="font-mono text-xs text-gray-500 tracking-wider uppercase">Risk Chat</span>
        <span className="font-mono text-xs text-gray-400">Ask questions · Request edits</span>
      </div>

      {/* Messages */}
      <div className="flex flex-col gap-3 p-5 max-h-72 overflow-y-auto">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-sm text-sm px-4 py-2.5 ${
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
            <div className="bg-gray-50 border border-gray-100 px-4 py-2.5 text-sm text-gray-400">
              Thinking...
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-gray-100 p-4 flex gap-2">
        <button
          onClick={toggleRecording}
          disabled={loading}
          className={`w-9 h-9 flex items-center justify-center border transition-colors shrink-0 ${
            isRecording
              ? "bg-red-500 border-red-500 text-white"
              : "border-gray-200 text-gray-500 hover:border-gray-400"
          }`}
        >
          {isRecording ? "■" : "🎙"}
        </button>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && sendMessage(input)}
          placeholder="Ask about risks or request protocol changes..."
          disabled={loading}
          className="flex-1 border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-gray-400"
        />
        <button
          onClick={() => sendMessage(input)}
          disabled={loading || !input.trim()}
          className="px-4 py-2 bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  );
}