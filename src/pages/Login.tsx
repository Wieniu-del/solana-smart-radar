import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Loader2, Lock, Mail, Radar } from "lucide-react";

const Login = () => {
  const { user, loading, signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (user) return <Navigate to="/" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await signIn(email, password);
    if (error) setError(error.message);
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full bg-primary/5 blur-[120px]" />
      </div>

      <Card className="w-full max-w-sm border-border/50 bg-card/80 backdrop-blur-xl relative z-10">
        <CardHeader className="text-center space-y-4 pb-2">
          <div className="mx-auto flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20">
            <Radar className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold font-heading text-foreground">
              Smart Money Radar
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Zaloguj się, aby kontynuować
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-xs text-muted-foreground uppercase tracking-wider">
                Email
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="twoj@email.com"
                  className="pl-10 bg-muted/50 border-border"
                  required
                  autoComplete="email"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-xs text-muted-foreground uppercase tracking-wider">
                Hasło
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pl-10 bg-muted/50 border-border"
                  required
                  autoComplete="current-password"
                />
              </div>
            </div>

            {error && (
              <p className="text-xs text-destructive bg-destructive/10 rounded-md p-2 text-center">
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={submitting}
              className="w-full font-semibold"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Zaloguj się
            </Button>
          </form>

          <p className="text-[10px] text-muted-foreground/50 text-center mt-6">
            Dostęp tylko dla autoryzowanych użytkowników
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;
