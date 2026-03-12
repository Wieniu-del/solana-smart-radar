import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { BookOpen, Plus, Trash2, Edit2, Save, X, Star, TrendingUp, TrendingDown, Filter, Calendar, Tag } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import LivePulse from "@/components/LivePulse";

type JournalEntry = {
  id: string;
  entry_type: string;
  title: string | null;
  notes: string | null;
  emotion: string | null;
  tags: string[];
  pnl_sol: number | null;
  pnl_pct: number | null;
  token_symbol: string | null;
  token_mint: string | null;
  action: string | null;
  amount_sol: number | null;
  lesson: string | null;
  rating: number | null;
  created_at: string;
  position_id: string | null;
  // joined from open_positions
  pos_status?: string | null;
  pos_close_reason?: string | null;
  pos_pnl_pct?: number | null;
};

const EMOTIONS = ["😎 Pewny", "😰 Strach", "🤑 Chciwość", "😤 Frustracja", "🧘 Spokój", "🎯 Skupiony"];

const Journal = () => {
  const { user } = useAuth();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [filterEmotion, setFilterEmotion] = useState<string | null>(null);

  const [form, setForm] = useState({
    title: "",
    notes: "",
    emotion: "",
    tags: "" as string,
    token_symbol: "",
    action: "BUY" as string,
    amount_sol: "",
    pnl_sol: "",
    pnl_pct: "",
    lesson: "",
    rating: 0,
  });

  const loadEntries = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    
    // Load journal entries
    const { data: journalData } = await supabase
      .from("journal_entries")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200);

    // Load position statuses for entries that have position_id
    const positionIds = (journalData || [])
      .map(e => e.position_id)
      .filter(Boolean) as string[];

    let positionMap: Record<string, { status: string; close_reason: string | null; pnl_pct: number | null }> = {};
    
    if (positionIds.length > 0) {
      const { data: posData } = await supabase
        .from("open_positions")
        .select("id, status, close_reason, pnl_pct")
        .in("id", positionIds);
      
      (posData || []).forEach(p => {
        positionMap[p.id] = { status: p.status, close_reason: p.close_reason, pnl_pct: p.pnl_pct };
      });
    }

    const enriched = (journalData || []).map(e => ({
      ...e,
      tags: e.tags || [],
      pos_status: e.position_id ? positionMap[e.position_id]?.status || null : null,
      pos_close_reason: e.position_id ? positionMap[e.position_id]?.close_reason || null : null,
      pos_pnl_pct: e.position_id ? positionMap[e.position_id]?.pnl_pct || null : null,
    })) as JournalEntry[];

    setEntries(enriched);
    setLoading(false);
  }, [user]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  const resetForm = () => {
    setForm({ title: "", notes: "", emotion: "", tags: "", token_symbol: "", action: "BUY", amount_sol: "", pnl_sol: "", pnl_pct: "", lesson: "", rating: 0 });
    setShowForm(false);
    setEditingId(null);
  };

  const handleSave = async () => {
    if (!user) return;
    const payload = {
      user_id: user.id,
      entry_type: "manual",
      title: form.title || null,
      notes: form.notes || null,
      emotion: form.emotion || null,
      tags: form.tags ? form.tags.split(",").map(t => t.trim()).filter(Boolean) : [],
      token_symbol: form.token_symbol || null,
      action: form.action || null,
      amount_sol: form.amount_sol ? Number(form.amount_sol) : null,
      pnl_sol: form.pnl_sol ? Number(form.pnl_sol) : null,
      pnl_pct: form.pnl_pct ? Number(form.pnl_pct) : null,
      lesson: form.lesson || null,
      rating: form.rating || null,
    };

    if (editingId) {
      const { error } = await supabase.from("journal_entries").update(payload).eq("id", editingId);
      if (error) { toast({ title: "Błąd", description: error.message, variant: "destructive" }); return; }
      toast({ title: "Zaktualizowano wpis" });
    } else {
      const { error } = await supabase.from("journal_entries").insert(payload);
      if (error) { toast({ title: "Błąd", description: error.message, variant: "destructive" }); return; }
      toast({ title: "Dodano wpis do dziennika" });
    }
    resetForm();
    loadEntries();
  };

  const handleDelete = async (id: string) => {
    await supabase.from("journal_entries").delete().eq("id", id);
    toast({ title: "Usunięto wpis" });
    loadEntries();
  };

  const startEdit = (entry: JournalEntry) => {
    setForm({
      title: entry.title || "",
      notes: entry.notes || "",
      emotion: entry.emotion || "",
      tags: (entry.tags || []).join(", "),
      token_symbol: entry.token_symbol || "",
      action: entry.action || "BUY",
      amount_sol: entry.amount_sol?.toString() || "",
      pnl_sol: entry.pnl_sol?.toString() || "",
      pnl_pct: entry.pnl_pct?.toString() || "",
      lesson: entry.lesson || "",
      rating: entry.rating || 0,
    });
    setEditingId(entry.id);
    setShowForm(true);
  };

  // Stats
  const totalEntries = entries.length;
  const avgRating = entries.filter(e => e.rating).reduce((s, e) => s + (e.rating || 0), 0) / (entries.filter(e => e.rating).length || 1);
  const totalPnl = entries.reduce((s, e) => s + (e.pnl_sol || 0), 0);
  const wins = entries.filter(e => (e.pnl_sol || 0) > 0).length;
  const losses = entries.filter(e => (e.pnl_sol || 0) < 0).length;

  const allTags = [...new Set(entries.flatMap(e => e.tags || []))];

  const filtered = entries.filter(e => {
    if (filterTag && !(e.tags || []).includes(filterTag)) return false;
    if (filterEmotion && e.emotion !== filterEmotion) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BookOpen className="h-6 w-6" style={{ color: "hsl(200, 100%, 70%)" }} />
          <h1 className="text-2xl font-black text-foreground">Dziennik Traidera</h1>
          <LivePulse color="bg-secondary" />
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all"
          style={{ background: "hsl(200, 80%, 50%)", color: "hsl(220, 20%, 7%)" }}
        >
          <Plus className="h-4 w-4" /> Nowy wpis
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatBox label="Wpisy" value={totalEntries} color="hsl(200, 100%, 70%)" />
        <StatBox label="Śr. ocena" value={avgRating.toFixed(1)} color="hsl(38, 100%, 55%)" />
        <StatBox label="P&L" value={`${totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(3)} SOL`} color={totalPnl >= 0 ? "hsl(155, 100%, 50%)" : "hsl(0, 100%, 60%)"} />
        <StatBox label="Wygrane" value={wins} color="hsl(155, 100%, 50%)" />
        <StatBox label="Przegrane" value={losses} color="hsl(0, 100%, 60%)" />
      </div>

      {/* Filters */}
      {(allTags.length > 0 || entries.some(e => e.emotion)) && (
        <div className="flex flex-wrap gap-2 items-center">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          {allTags.map(tag => (
            <button key={tag} onClick={() => setFilterTag(filterTag === tag ? null : tag)}
              className={`text-[10px] px-2 py-0.5 rounded-full border font-mono transition-all ${filterTag === tag ? "border-secondary text-secondary bg-secondary/10" : "border-border text-muted-foreground hover:border-muted-foreground"}`}>
              #{tag}
            </button>
          ))}
          {EMOTIONS.filter(em => entries.some(e => e.emotion === em)).map(em => (
            <button key={em} onClick={() => setFilterEmotion(filterEmotion === em ? null : em)}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-all ${filterEmotion === em ? "border-secondary text-secondary bg-secondary/10" : "border-border text-muted-foreground hover:border-muted-foreground"}`}>
              {em}
            </button>
          ))}
          {(filterTag || filterEmotion) && (
            <button onClick={() => { setFilterTag(null); setFilterEmotion(null); }} className="text-[10px] text-destructive underline">Wyczyść</button>
          )}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="neon-card rounded-xl p-6 space-y-4" style={{ borderColor: "hsl(200, 80%, 40%, 0.3)" }}>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-foreground">{editingId ? "Edytuj wpis" : "Nowy wpis"}</h3>
            <button onClick={resetForm}><X className="h-4 w-4 text-muted-foreground hover:text-foreground" /></button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Tytuł (np. 'Trade na BONK')" className="bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-secondary" />
            <input value={form.token_symbol} onChange={e => setForm(f => ({ ...f, token_symbol: e.target.value }))}
              placeholder="Token (np. BONK)" className="bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-secondary" />
          </div>

          <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            placeholder="Notatki — co widziałeś, dlaczego wszedłeś/wyszedłeś..."
            className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-secondary min-h-[80px]" />

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="text-[10px] text-muted-foreground uppercase">Akcja</label>
              <select value={form.action} onChange={e => setForm(f => ({ ...f, action: e.target.value }))}
                className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground">
                <option value="BUY">BUY</option>
                <option value="SELL">SELL</option>
                <option value="HOLD">HOLD</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase">Kwota SOL</label>
              <input type="number" step="0.001" value={form.amount_sol} onChange={e => setForm(f => ({ ...f, amount_sol: e.target.value }))}
                className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase">P&L (SOL)</label>
              <input type="number" step="0.001" value={form.pnl_sol} onChange={e => setForm(f => ({ ...f, pnl_sol: e.target.value }))}
                className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase">P&L (%)</label>
              <input type="number" step="0.1" value={form.pnl_pct} onChange={e => setForm(f => ({ ...f, pnl_pct: e.target.value }))}
                className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground" />
            </div>
          </div>

          {/* Emotion */}
          <div>
            <label className="text-[10px] text-muted-foreground uppercase mb-1 block">Emocja</label>
            <div className="flex flex-wrap gap-2">
              {EMOTIONS.map(em => (
                <button key={em} onClick={() => setForm(f => ({ ...f, emotion: f.emotion === em ? "" : em }))}
                  className={`text-xs px-3 py-1 rounded-full border transition-all ${form.emotion === em ? "border-secondary text-secondary bg-secondary/10" : "border-border text-muted-foreground hover:border-muted-foreground"}`}>
                  {em}
                </button>
              ))}
            </div>
          </div>

          {/* Tags */}
          <input value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
            placeholder="Tagi (rozdzielone przecinkami: degen, snipe, moonshot)"
            className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-secondary" />

          {/* Lesson */}
          <textarea value={form.lesson} onChange={e => setForm(f => ({ ...f, lesson: e.target.value }))}
            placeholder="Lekcja — czego się nauczyłeś?"
            className="w-full bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-secondary min-h-[60px]" />

          {/* Rating */}
          <div>
            <label className="text-[10px] text-muted-foreground uppercase mb-1 block">Ocena trade'a</label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} onClick={() => setForm(f => ({ ...f, rating: f.rating === n ? 0 : n }))}>
                  <Star className={`h-5 w-5 transition-all ${form.rating >= n ? "text-neon-amber fill-neon-amber" : "text-muted-foreground"}`} />
                </button>
              ))}
            </div>
          </div>

          <button onClick={handleSave}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold transition-all"
            style={{ background: "hsl(200, 80%, 50%)", color: "hsl(220, 20%, 7%)" }}>
            <Save className="h-4 w-4" /> {editingId ? "Zapisz zmiany" : "Dodaj wpis"}
          </button>
        </div>
      )}

      {/* Entries */}
      {loading ? (
        <div className="text-center py-12"><div className="h-8 w-8 border-2 border-secondary border-t-transparent rounded-full animate-spin mx-auto" /></div>
      ) : filtered.length === 0 ? (
        <div className="neon-card rounded-xl p-12 text-center">
          <BookOpen className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Brak wpisów w dzienniku</p>
          <p className="text-xs text-muted-foreground mt-1">Kliknij "Nowy wpis" aby zacząć dokumentować swoje trade'y</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((entry, i) => (
            <div key={entry.id} className="neon-card rounded-xl p-4 hover:bg-muted/10 transition-all duration-300"
              style={{ animation: `fade-in-up 0.3s ease-out ${i * 0.04}s both` }}>
              <div className="flex items-start gap-3">
                {/* PnL indicator */}
                <div className="pt-1">
                  {(entry.pnl_sol || 0) > 0 ? <TrendingUp className="h-5 w-5 text-primary" /> :
                    (entry.pnl_sol || 0) < 0 ? <TrendingDown className="h-5 w-5 text-destructive" /> :
                    <BookOpen className="h-5 w-5 text-muted-foreground" />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    {entry.action && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${entry.action === "BUY" ? "bg-primary/15 text-primary" : entry.action === "SELL" ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground"}`}>
                        {entry.action}
                      </span>
                    )}
                    {/* Position status badge */}
                    {entry.pos_status && (() => {
                      const closeReasonMap: Record<string, { label: string; icon: string; colorClass: string }> = {
                        stop_loss: { label: "STOP-LOSS", icon: "🔴", colorClass: "border-destructive/50 bg-destructive/15 text-destructive" },
                        fast_loss_cut: { label: "FAST LOSS CUT", icon: "⚡", colorClass: "border-destructive/50 bg-destructive/15 text-destructive" },
                        trailing_stop: { label: "TRAILING STOP (PROFIT)", icon: "🟢", colorClass: "border-primary/50 bg-primary/15 text-primary" },
                        take_profit: { label: "TAKE-PROFIT", icon: "🟢", colorClass: "border-primary/50 bg-primary/15 text-primary" },
                        profit_fade: { label: "PROFIT FADE", icon: "🟠", colorClass: "border-accent/50 bg-accent/15 text-accent-foreground" },
                        time_decay: { label: "TIME DECAY", icon: "⏰", colorClass: "border-border bg-muted/30 text-muted-foreground" },
                        dead_token: { label: "DEAD TOKEN", icon: "💀", colorClass: "border-destructive/50 bg-destructive/15 text-destructive" },
                        manual: { label: "RĘCZNE ZAMKNIĘCIE", icon: "⚪", colorClass: "border-border bg-muted/30 text-muted-foreground" },
                      };
                      if (entry.pos_status === "open") {
                        return (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-secondary/50 bg-secondary/10 text-secondary">
                            🟢 W PORTFELU
                          </span>
                        );
                      }
                      const reason = entry.pos_close_reason ? closeReasonMap[entry.pos_close_reason] : null;
                      if (reason) {
                        return (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${reason.colorClass}`}>
                            {reason.icon} SPRZEDANY: {reason.label}
                          </span>
                        );
                      }
                      return (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                          (entry.pos_pnl_pct || 0) >= 0 ? "border-primary/50 bg-primary/10 text-primary" : "border-destructive/50 bg-destructive/10 text-destructive"
                        }`}>
                          🔴 ZAMKNIĘTA{entry.pos_close_reason ? `: ${entry.pos_close_reason}` : ""}
                        </span>
                      );
                    })()}
                    <span className="text-sm font-bold text-foreground">{entry.title || entry.token_symbol || "Bez tytułu"}</span>
                    {entry.emotion && <span className="text-xs">{entry.emotion}</span>}
                    {entry.rating && (
                      <span className="flex gap-0.5">
                        {[1, 2, 3, 4, 5].map(n => (
                          <Star key={n} className={`h-3 w-3 ${entry.rating! >= n ? "text-neon-amber fill-neon-amber" : "text-muted-foreground/30"}`} />
                        ))}
                      </span>
                    )}
                  </div>

                  {entry.notes && <p className="text-xs text-muted-foreground mb-1.5 line-clamp-2">{entry.notes}</p>}
                  {entry.lesson && <p className="text-xs text-secondary/80 italic mb-1.5">💡 {entry.lesson}</p>}

                  <div className="flex items-center gap-3 flex-wrap">
                    {entry.pnl_sol !== null && (
                      <span className={`text-xs font-mono font-bold ${(entry.pnl_sol || 0) >= 0 ? "text-primary" : "text-destructive"}`}>
                        {(entry.pnl_sol || 0) >= 0 ? "+" : ""}{entry.pnl_sol?.toFixed(4)} SOL
                      </span>
                    )}
                    {entry.pnl_pct !== null && (
                      <span className={`text-xs font-mono ${(entry.pnl_pct || 0) >= 0 ? "text-primary/70" : "text-destructive/70"}`}>
                        ({(entry.pnl_pct || 0) >= 0 ? "+" : ""}{entry.pnl_pct?.toFixed(1)}%)
                      </span>
                    )}
                    {entry.amount_sol && <span className="text-[10px] text-muted-foreground font-mono">{entry.amount_sol} SOL</span>}
                    {(entry.tags || []).map(tag => (
                      <span key={tag} className="text-[10px] text-secondary/70 font-mono">#{tag}</span>
                    ))}
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      <Calendar className="h-3 w-3 inline mr-1" />
                      {new Date(entry.created_at).toLocaleDateString("pl-PL")} {new Date(entry.created_at).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => startEdit(entry)} className="p-1.5 rounded hover:bg-muted/50 transition-colors">
                    <Edit2 className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                  </button>
                  <button onClick={() => handleDelete(entry.id)} className="p-1.5 rounded hover:bg-destructive/10 transition-colors">
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function StatBox({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="neon-card rounded-lg p-3 text-center">
      <p className="text-lg font-bold font-mono" style={{ color }}>{value}</p>
      <p className="text-[10px] text-muted-foreground uppercase">{label}</p>
    </div>
  );
}

export default Journal;
