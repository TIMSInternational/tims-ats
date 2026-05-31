'use client';

import { useState, useRef, useEffect } from 'react';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'bot';
  timestamp: Date;
}

const AUTO_REPLIES: Record<string, string> = {
  'hola': 'Hola! Como puedo ayudarte hoy?',
  'ayuda': 'Estoy aqui para ayudarte. Puedes preguntarme sobre:\n• Configuracion de la plataforma\n• Gestion de organizaciones\n• Facturacion y suscripciones\n• Problemas tecnicos',
  'precio': 'Nuestros planes van desde $499/mes (Starter) hasta $2,499/mes (Enterprise). Visita /platform/subscriptions para mas detalles.',
  'error': 'Lamento escuchar eso. Puedes describir el error? Tambien puedes revisar /platform/health para ver el estado del sistema.',
  'contacto': 'Puedes contactarnos en:\n• Email: soporte@timshr.com\n• WhatsApp: +57 300 123 4567\n• Horario: Lun-Vie 8am-6pm COT',
};

function getAutoReply(text: string): string {
  const lower = text.toLowerCase();
  for (const [key, reply] of Object.entries(AUTO_REPLIES)) {
    if (lower.includes(key)) return reply;
  }
  return 'Gracias por tu mensaje. Un miembro del equipo de soporte te respondera pronto. Mientras tanto, puedes revisar nuestra documentacion o visitar la pagina de soporte.';
}

export function SupportChat({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [messages, setMessages] = useState<Message[]>([
    { id: '0', text: 'Hola! Soy el asistente de TIMS. En que puedo ayudarte?', sender: 'bot', timestamp: new Date() },
  ]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing]);

  const handleSend = () => {
    if (!input.trim()) return;
    const userMsg: Message = { id: Date.now().toString(), text: input.trim(), sender: 'user', timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setTyping(true);

    setTimeout(() => {
      const reply: Message = { id: (Date.now() + 1).toString(), text: getAutoReply(userMsg.text), sender: 'bot', timestamp: new Date() };
      setMessages(prev => [...prev, reply]);
      setTyping(false);
    }, 800 + Math.random() * 700);
  };

  if (!open) return null;

  return (
    <div className="fixed bottom-6 right-6 w-[380px] h-[520px] bg-white rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.15)] border border-[#EDEDED] z-50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-[#1F114C] px-5 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-[#DD0C15] flex items-center justify-center">
            <span className="text-white text-[11px] font-bold">T</span>
          </div>
          <div>
            <p className="text-white text-[13px] font-semibold">Soporte TIMS</p>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
              <span className="text-white/50 text-[10px]">En linea</span>
            </div>
          </div>
        </div>
        <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#FAFAFA]">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[280px] px-3.5 py-2.5 rounded-2xl text-[13px] leading-relaxed whitespace-pre-line ${
              msg.sender === 'user'
                ? 'bg-[#1F114C] text-white rounded-br-md'
                : 'bg-white text-[#333] shadow-[0_1px_3px_rgba(0,0,0,0.06)] rounded-bl-md'
            }`}>
              {msg.text}
            </div>
          </div>
        ))}
        {typing && (
          <div className="flex justify-start">
            <div className="bg-white px-4 py-3 rounded-2xl rounded-bl-md shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
              <div className="flex gap-1">
                <div className="w-2 h-2 rounded-full bg-[#8B8B8B] animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 rounded-full bg-[#8B8B8B] animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 rounded-full bg-[#8B8B8B] animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-[#EDEDED] bg-white shrink-0">
        <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Escribe tu mensaje..."
            className="flex-1 h-10 px-4 rounded-xl border border-[#EDEDED] bg-[#FAFAFA] text-[13px] text-[#333] placeholder:text-[#8B8B8B] focus:outline-none focus:ring-1 focus:ring-[#1F114C]/20 focus:border-[#1F114C]/30"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="w-10 h-10 rounded-xl bg-[#1F114C] flex items-center justify-center text-white disabled:opacity-30 hover:bg-[#2a1a5e] transition shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
          </button>
        </form>
      </div>
    </div>
  );
}
