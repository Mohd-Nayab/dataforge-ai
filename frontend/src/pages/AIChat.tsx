import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, Send, User as UserIcon } from "lucide-react";
import { FormEvent, useRef, useState } from "react";
import toast from "react-hot-toast";

import { NoDataset, PageHeader } from "@/components/ui/States";
import { dataApi } from "@/lib/api";
import type { ChatResponse } from "@/lib/types";
import { useDataset } from "@/store/dataset";

interface Message {
  role: "user" | "assistant";
  text: string;
  data?: unknown;
  action?: string | null;
}

const SUGGESTIONS = [
  "Explain this dataset",
  "Remove duplicate rows",
  "Show correlation matrix",
  "Fill missing values",
  "Detect anomalies",
];

export default function AIChat() {
  const { active, setActive } = useDataset();
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const chat = useMutation({
    mutationFn: (message: string) => dataApi.chat(active!.id, message),
    onSuccess: async (res: ChatResponse, message) => {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: res.reply, data: res.data, action: res.action },
      ]);
      // If the assistant proposed an executable operation, run it.
      if (res.action && res.action !== "auto_fill") {
        try {
          const result = await dataApi.clean(active!.id, res.action, res.params ?? {});
          setActive(result.meta);
          queryClient.invalidateQueries({ queryKey: ["preview"] });
          queryClient.invalidateQueries({ queryKey: ["overview"] });
          setMessages((prev) => [
            ...prev,
            { role: "assistant", text: `✓ ${result.message}` },
          ]);
        } catch {
          /* surface nothing extra */
        }
      } else if (res.action === "auto_fill") {
        const result = await dataApi.autoClean(active!.id);
        setActive(result.meta);
        queryClient.invalidateQueries({ queryKey: ["preview"] });
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: "✓ Filled missing values." },
        ]);
      }
      setTimeout(
        () => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }),
        50
      );
    },
    onError: () => toast.error("Assistant unavailable"),
  });

  function send(text: string) {
    if (!text.trim()) return;
    setMessages((prev) => [...prev, { role: "user", text }]);
    setInput("");
    chat.mutate(text);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    send(input);
  }

  if (!active) return <NoDataset message="Select a dataset to chat about your data." />;

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <PageHeader title="AI Assistant" subtitle={`Chatting about ${active.name}`} />

      <div ref={scrollRef} className="glass flex-1 space-y-4 overflow-y-auto p-5">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600/20 text-brand-300">
              <Bot className="h-7 w-7" />
            </div>
            <p className="text-slate-300">Ask anything about your data.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="btn-ghost text-xs" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}
          >
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                m.role === "user"
                  ? "bg-white/10 text-slate-200"
                  : "bg-brand-600/20 text-brand-300"
              }`}
            >
              {m.role === "user" ? (
                <UserIcon className="h-4 w-4" />
              ) : (
                <Bot className="h-4 w-4" />
              )}
            </div>
            <div
              className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${
                m.role === "user"
                  ? "bg-brand-600/30 text-slate-100"
                  : "bg-white/5 text-slate-200"
              }`}
            >
              <p className="whitespace-pre-wrap">{m.text}</p>
              {m.data != null && (
                <pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-black/30 p-2 text-[11px] text-slate-400">
                  {JSON.stringify(m.data, null, 2)}
                </pre>
              )}
            </div>
          </div>
        ))}

        {chat.isPending && (
          <div className="flex gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600/20 text-brand-300">
              <Bot className="h-4 w-4" />
            </div>
            <div className="rounded-2xl bg-white/5 px-4 py-3">
              <div className="flex gap-1">
                <span className="h-2 w-2 animate-bounce rounded-full bg-slate-500 [animation-delay:-0.3s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-slate-500 [animation-delay:-0.15s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-slate-500" />
              </div>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="mt-4 flex gap-2">
        <input
          className="input flex-1"
          placeholder="Ask about your data…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="btn-primary px-4" disabled={chat.isPending}>
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
